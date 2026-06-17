// 카드(글) CRUD + 파일 업로드 + 실시간 구독
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { db, storage } from "./firebase.js";
import { getUid } from "./auth.js";
import { compressImage } from "./imageUtil.js";

const cardsCol = (columnId) => collection(db, "columns", columnId, "cards");

/** 한 칼럼의 카드 실시간 구독 (최신순). cb(cards[]) */
export function subscribeCards(columnId, cb) {
  const q = query(cardsCol(columnId), orderBy("order", "desc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

/** 첨부 종류 판별: 이미지 / PDF / 기타 문서(doc) */
function detectFileType(file) {
  if ((file.type || "").startsWith("image/")) return "image";
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")) return "pdf";
  return "doc"; // hwp/hwpx, txt, ppt(x), xls(x), doc(x), csv 등
}

/**
 * 파일을 Storage 에 업로드한다.
 * @returns {Promise<{fileUrl, fileType, fileName, filePath}>}
 */
export async function uploadFile(file) {
  const fileType = detectFileType(file);
  const origName = file.name || "";
  if (fileType === "image") file = await compressImage(file); // 이미지는 업로드 전 압축
  const safeName = origName
    ? origName.replace(/[^\w.\-가-힣]/g, "_")
    : (fileType === "pdf" ? "file.pdf" : fileType === "image" ? "image.png" : "file");
  const path = `uploads/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
  const sref = storageRef(storage, path);
  await uploadBytes(sref, file);
  const fileUrl = await getDownloadURL(sref);
  return { fileUrl, fileType, fileName: safeName, filePath: path };
}

/** 여러 파일을 업로드해 첨부 엔트리 배열로 반환 */
export async function uploadFiles(files) {
  const metas = await Promise.all([...files].map(uploadFile));
  return metas.map(metaToEntry);
}

/** uploadFile 결과 → 카드 저장용 첨부 엔트리 */
function metaToEntry(meta) {
  return { url: meta.fileUrl, type: meta.fileType, name: meta.fileName, path: meta.filePath };
}

/**
 * 카드의 첨부를 항상 배열로 반환한다 (구버전 단일 첨부 호환).
 * @returns {{url, type, name, path}[]}
 */
export function cardFiles(card) {
  if (Array.isArray(card.files) && card.files.length) return card.files;
  if (card.fileUrl) return [{ url: card.fileUrl, type: card.fileType, name: card.fileName, path: card.filePath || null }];
  return [];
}

/**
 * 카드를 추가한다.
 * @param {string} columnId
 * @param {object} data { title, body, isPrompt, files?: File[], linkUrl, linkPreview, authorName }
 */
export async function addCard(columnId, data) {
  // 새 글 위치: "bottom"이면 맨 아래(최소 order-1), 기본은 맨 위(최대 order+1)
  const snap = await getDocs(query(cardsCol(columnId), orderBy("order", "desc")));
  let order;
  if (snap.empty) order = 1;
  else if (data.newCardPosition === "bottom") order = (snap.docs[snap.docs.length - 1].data().order ?? 0) - 1;
  else order = (snap.docs[0].data().order ?? 0) + 1;

  const files = data.files?.length ? await uploadFiles(data.files) : [];

  return addDoc(cardsCol(columnId), {
    title: data.title?.trim() || "",
    body: data.body?.trim() || "",
    isPrompt: !!data.isPrompt,
    files,
    // 구버전 단일 첨부 필드는 더 이상 사용하지 않음 (호환을 위해 null 로 유지)
    fileUrl: null,
    fileType: null,
    fileName: null,
    filePath: null,
    linkUrl: data.linkUrl?.trim() || null,
    linkPreview: data.linkPreview || null,
    authorName: data.authorName?.trim() || "익명",
    authorUid: getUid(),
    commentCount: 0,
    order,
    createdAt: serverTimestamp(),
  });
}

/**
 * 카드 수정 (텍스트/링크/프롬프트 여부 + 첨부 갱신).
 * @param {object} data { ..., keepFiles?: 유지할 기존 첨부 엔트리[], files?: 새로 추가할 File[], removedPaths?: 삭제할 Storage 경로[] }
 */
export async function updateCard(columnId, cardId, data) {
  const patch = {
    title: data.title?.trim() || "",
    body: data.body?.trim() || "",
    isPrompt: !!data.isPrompt,
    linkUrl: data.linkUrl?.trim() || null,
    linkPreview: data.linkPreview || null,
  };
  // 첨부 정보를 함께 넘긴 경우에만 갱신 (keepFiles/files 중 하나라도 정의되면)
  if (data.keepFiles !== undefined || data.files !== undefined) {
    const kept = (data.keepFiles || []).map((f) => ({ url: f.url, type: f.type, name: f.name, path: f.path || null }));
    const uploaded = data.files?.length ? await uploadFiles(data.files) : [];
    Object.assign(patch, {
      files: [...kept, ...uploaded],
      // 구버전 단일 첨부 필드 제거 (배열로 일원화)
      fileUrl: null,
      fileType: null,
      fileName: null,
      filePath: null,
    });
  }
  await updateDoc(doc(db, "columns", columnId, "cards", cardId), patch);

  // 제거된 기존 첨부의 Storage 파일 정리 (best-effort)
  for (const path of data.removedPaths || []) {
    try {
      await deleteObject(storageRef(storage, path));
    } catch (_) {
      /* 이미 없으면 무시 */
    }
  }
}

/**
 * 카드 순서를 시각적 배열대로 재배치한다 (칼럼 내 드래그 정렬).
 * 맨 위 카드가 가장 큰 order 값을 갖도록 일괄 갱신 (order 만 변경).
 * @param {string} columnId
 * @param {string[]} orderedIds 위→아래 순서의 카드 id 배열
 */
export function reorderCards(columnId, orderedIds) {
  const batch = writeBatch(db);
  const n = orderedIds.length;
  orderedIds.forEach((id, i) => {
    batch.update(doc(db, "columns", columnId, "cards", id), { order: n - i });
  });
  return batch.commit();
}

/** 글 비밀번호 잠금 설정/해제 (lockHash 만 변경) */
export function setCardLock(columnId, cardId, lockHash) {
  return updateDoc(doc(db, "columns", columnId, "cards", cardId), { lockHash });
}

/** 글 숨김 설정/해제 (hidden 만 변경) — 강사용 */
export function setCardHidden(columnId, cardId, hidden) {
  return updateDoc(doc(db, "columns", columnId, "cards", cardId), { hidden });
}

/**
 * 카드를 다른 게시판으로 복사한다 (이동은 복사 후 원본 삭제).
 * @param {boolean} ownFile  새 카드가 Storage 파일을 소유하는지 (이동=true / 복사=false: 원본과 공유)
 * @param {boolean} withComments 댓글까지 복사
 */
export async function copyCardTo(sourceColumnId, card, targetColumnId, { ownFile = false, withComments = false } = {}) {
  const snap = await getDocs(query(cardsCol(targetColumnId), orderBy("order", "desc")));
  const order = snap.empty ? 1 : (snap.docs[0].data().order ?? 0) + 1;
  // 복사는 파일 미소유(공유) → path 를 비워 삭제 시 원본 파일이 지워지지 않게 함
  const files = cardFiles(card).map((f) => ({
    url: f.url,
    type: f.type,
    name: f.name,
    path: ownFile ? (f.path || null) : null,
  }));
  const newRef = await addDoc(cardsCol(targetColumnId), {
    title: card.title || "",
    body: card.body || "",
    isPrompt: !!card.isPrompt,
    files,
    fileUrl: null,
    fileType: null,
    fileName: null,
    filePath: null,
    linkUrl: card.linkUrl || null,
    linkPreview: card.linkPreview || null,
    lockHash: card.lockHash || null,
    hidden: !!card.hidden,
    authorName: card.authorName || "익명",
    authorUid: getUid(),
    commentCount: withComments ? (card.commentCount || 0) : 0,
    order,
    createdAt: serverTimestamp(),
  });
  if (withComments) {
    const cSnap = await getDocs(
      query(collection(db, "columns", sourceColumnId, "cards", card.id, "comments"), orderBy("createdAt", "asc"))
    );
    for (const c of cSnap.docs) {
      const d = c.data();
      await addDoc(collection(db, "columns", targetColumnId, "cards", newRef.id, "comments"), {
        body: d.body, authorName: d.authorName, authorUid: getUid(), createdAt: serverTimestamp(),
      });
    }
  }
  return newRef;
}

/** 카드 이동 = 댓글까지 복사 후 원본 삭제(파일은 새 카드가 이어받음) */
export async function moveCardTo(sourceColumnId, card, targetColumnId) {
  if (targetColumnId === sourceColumnId) return;
  await copyCardTo(sourceColumnId, card, targetColumnId, { ownFile: true, withComments: true });
  await deleteCard(sourceColumnId, card, { keepFile: true });
}

/** 두 카드의 order 를 맞바꿔 위/아래로 이동 (강사 위치 수정용) */
export function swapCardOrder(columnId, cardA, cardB) {
  const batch = writeBatch(db);
  batch.update(doc(db, "columns", columnId, "cards", cardA.id), { order: cardB.order });
  batch.update(doc(db, "columns", columnId, "cards", cardB.id), { order: cardA.order });
  return batch.commit();
}

/** 카드 삭제 (하위 댓글 + Storage 파일 정리). keepFile 이면 파일은 남김(이동 시) */
export async function deleteCard(columnId, card, { keepFile = false } = {}) {
  const commentsSnap = await getDocs(
    collection(db, "columns", columnId, "cards", card.id, "comments")
  );
  const batch = writeBatch(db);
  commentsSnap.docs.forEach((c) => batch.delete(c.ref));
  batch.delete(doc(db, "columns", columnId, "cards", card.id));
  await batch.commit();

  if (!keepFile) {
    const paths = cardFiles(card).map((f) => f.path).filter(Boolean);
    for (const path of paths) {
      try {
        await deleteObject(storageRef(storage, path));
      } catch (_) {
        /* 파일이 이미 없으면 무시 */
      }
    }
  }
}
