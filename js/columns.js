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

export async function addColumn(title, writePermission = "all", layout = "list") {
  // 새 칼럼은 맨 뒤로
  const snap = await getDocs(query(columnsRef, orderBy("order", "desc")));
  const maxOrder = snap.empty ? 0 : (snap.docs[0].data().order ?? 0);
  return addDoc(columnsRef, {
    title: title.trim(),
    order: maxOrder + 1,
    writePermission,
    layout, // "list" | "gallery"
    createdAt: serverTimestamp(),
  });
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
