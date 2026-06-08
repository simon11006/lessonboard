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

/**
 * 파일을 Storage 에 업로드한다.
 * @returns {Promise<{fileUrl, fileType, fileName, filePath}>}
 */
export async function uploadFile(file) {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const fileType = isPdf ? "pdf" : "image";
  if (!isPdf) file = await compressImage(file); // 이미지는 업로드 전 압축
  const safeName = file.name ? file.name.replace(/[^\w.\-가-힣]/g, "_") : `${fileType}.png`;
  const path = `uploads/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
  const sref = storageRef(storage, path);
  await uploadBytes(sref, file);
  const fileUrl = await getDownloadURL(sref);
  return { fileUrl, fileType, fileName: safeName, filePath: path };
}

/**
 * 카드를 추가한다.
 * @param {string} columnId
 * @param {object} data { title, body, isPrompt, file?, fileMeta?, linkUrl, linkPreview, authorName }
 */
export async function addCard(columnId, data) {
  // 새 글 위치: "bottom"이면 맨 아래(최소 order-1), 기본은 맨 위(최대 order+1)
  const snap = await getDocs(query(cardsCol(columnId), orderBy("order", "desc")));
  let order;
  if (snap.empty) order = 1;
  else if (data.newCardPosition === "bottom") order = (snap.docs[snap.docs.length - 1].data().order ?? 0) - 1;
  else order = (snap.docs[0].data().order ?? 0) + 1;

  let fileMeta = data.fileMeta || null;
  if (data.file) fileMeta = await uploadFile(data.file);

  return addDoc(cardsCol(columnId), {
    title: data.title?.trim() || "",
    body: data.body?.trim() || "",
    isPrompt: !!data.isPrompt,
    fileUrl: fileMeta?.fileUrl || null,
    fileType: fileMeta?.fileType || null,
    fileName: fileMeta?.fileName || null,
    filePath: fileMeta?.filePath || null,
    linkUrl: data.linkUrl?.trim() || null,
    linkPreview: data.linkPreview || null,
    authorName: data.authorName?.trim() || "익명",
    authorUid: getUid(),
    order,
    createdAt: serverTimestamp(),
  });
}

/** 카드 수정 (텍스트/링크/프롬프트 여부). 새 파일이 있으면 교체 */
export async function updateCard(columnId, cardId, data) {
  const patch = {
    title: data.title?.trim() || "",
    body: data.body?.trim() || "",
    isPrompt: !!data.isPrompt,
    linkUrl: data.linkUrl?.trim() || null,
    linkPreview: data.linkPreview || null,
  };
  if (data.file) {
    const meta = await uploadFile(data.file);
    Object.assign(patch, {
      fileUrl: meta.fileUrl,
      fileType: meta.fileType,
      fileName: meta.fileName,
      filePath: meta.filePath,
    });
  } else if (data.removeFile) {
    Object.assign(patch, { fileUrl: null, fileType: null, fileName: null, filePath: null });
  }
  return updateDoc(doc(db, "columns", columnId, "cards", cardId), patch);
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

/** 두 카드의 order 를 맞바꿔 위/아래로 이동 (강사 위치 수정용) */
export function swapCardOrder(columnId, cardA, cardB) {
  const batch = writeBatch(db);
  batch.update(doc(db, "columns", columnId, "cards", cardA.id), { order: cardB.order });
  batch.update(doc(db, "columns", columnId, "cards", cardB.id), { order: cardA.order });
  return batch.commit();
}

/** 카드 삭제 (하위 댓글 + Storage 파일 정리) */
export async function deleteCard(columnId, card) {
  const commentsSnap = await getDocs(
    collection(db, "columns", columnId, "cards", card.id, "comments")
  );
  const batch = writeBatch(db);
  commentsSnap.docs.forEach((c) => batch.delete(c.ref));
  batch.delete(doc(db, "columns", columnId, "cards", card.id));
  await batch.commit();

  if (card.filePath) {
    try {
      await deleteObject(storageRef(storage, card.filePath));
    } catch (_) {
      /* 파일이 이미 없으면 무시 */
    }
  }
}
