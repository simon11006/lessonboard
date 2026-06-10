// 칼럼(게시판) CRUD + 실시간 구독
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
import { db } from "./firebase.js";

const columnsRef = collection(db, "columns");

/** 칼럼 실시간 구독 (order 오름차순). cb(columns[]) */
export function subscribeColumns(cb) {
  const q = query(columnsRef, orderBy("order", "asc"));
  return onSnapshot(q, (snap) => {
    const columns = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    cb(columns);
  });
}

export async function addColumn(title, writePermission = "all", layout = "list", tabId = null, newCardPosition = "top", galleryCols = 3) {
  // 새 칼럼은 맨 뒤로
  const snap = await getDocs(query(columnsRef, orderBy("order", "desc")));
  const maxOrder = snap.empty ? 0 : (snap.docs[0].data().order ?? 0);
  return addDoc(columnsRef, {
    title: title.trim(),
    order: maxOrder + 1,
    writePermission,
    layout, // "list" | "gallery"
    galleryCols, // 갤러리 열 수 (2|3|4)
    tabId, // 속한 탭 (없으면 null → 첫 탭에 표시)
    newCardPosition, // "top" | "bottom" — 새 글을 어디에 넣을지
    createdAt: serverTimestamp(),
  });
}

export function setColumnTab(columnId, tabId) {
  return updateDoc(doc(db, "columns", columnId), { tabId });
}

export function setColumnNewCardPosition(columnId, newCardPosition) {
  return updateDoc(doc(db, "columns", columnId), { newCardPosition });
}

export function setColumnGalleryCols(columnId, galleryCols) {
  return updateDoc(doc(db, "columns", columnId), { galleryCols });
}

/** 게시판(칼럼) 비밀번호 잠금 설정/해제 */
export function setColumnLock(columnId, lockHash) {
  return updateDoc(doc(db, "columns", columnId), { lockHash });
}

export function renameColumn(columnId, title) {
  return updateDoc(doc(db, "columns", columnId), { title: title.trim() });
}

export function setColumnPermission(columnId, writePermission) {
  return updateDoc(doc(db, "columns", columnId), { writePermission });
}

export function setColumnLayout(columnId, layout) {
  return updateDoc(doc(db, "columns", columnId), { layout });
}

/** 두 칼럼의 order 값을 맞바꿔 좌/우 이동 */
export async function swapColumnOrder(colA, colB) {
  const batch = writeBatch(db);
  batch.update(doc(db, "columns", colA.id), { order: colB.order });
  batch.update(doc(db, "columns", colB.id), { order: colA.order });
  return batch.commit();
}

/**
 * 칼럼을 시각적 배열대로 재배치한다 (헤더 드래그 정렬).
 * 같은 탭에 보이는 칼럼들끼리만 다루므로, 이들이 갖고 있던 order 값들을
 * 오름차순으로 모아 새 좌→우 순서에 그대로 다시 매긴다 (다른 탭 칼럼은 불변).
 * @param {string[]} orderedIds 좌→우 순서의 칼럼 id 배열
 * @param {number[]} sortedOrderValues 위 칼럼들의 기존 order 값(오름차순)
 */
export function reorderColumns(orderedIds, sortedOrderValues) {
  const batch = writeBatch(db);
  orderedIds.forEach((id, i) => {
    batch.update(doc(db, "columns", id), { order: sortedOrderValues[i] });
  });
  return batch.commit();
}

/** 칼럼 삭제 (하위 카드/댓글도 함께 정리) */
export async function deleteColumn(columnId) {
  const cardsSnap = await getDocs(collection(db, "columns", columnId, "cards"));
  for (const cardDoc of cardsSnap.docs) {
    const commentsSnap = await getDocs(
      collection(db, "columns", columnId, "cards", cardDoc.id, "comments")
    );
    const batch = writeBatch(db);
    commentsSnap.docs.forEach((c) => batch.delete(c.ref));
    batch.delete(cardDoc.ref);
    await batch.commit();
  }
  return deleteDoc(doc(db, "columns", columnId));
}
