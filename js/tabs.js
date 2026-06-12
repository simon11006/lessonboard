// 탭(상위 묶음) CRUD + 실시간 구독
// 구조: 탭 → 칼럼(column.tabId) → 카드. 탭이 없으면 기존처럼 단일 보드로 동작.
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  where,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase.js";

const tabsRef = collection(db, "tabs");

/** 탭이 하나도 없으면 기본 탭을 생성한다 (고정 ID 'default' → 동시 접속 시 중복 방지). */
export async function ensureDefaultTab() {
  const snap = await getDocs(tabsRef);
  if (!snap.empty) return;
  await setDoc(doc(db, "tabs", "default"), {
    title: "강의용 게시판",
    order: 0,
    type: "board",
    createdAt: serverTimestamp(),
  });
}

/** 탭 실시간 구독 (order 오름차순) */
export function subscribeTabs(cb) {
  return onSnapshot(query(tabsRef, orderBy("order", "asc")), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function addTab(title, type = "board") {
  const snap = await getDocs(query(tabsRef, orderBy("order", "desc")));
  const maxOrder = snap.empty ? 0 : (snap.docs[0].data().order ?? 0);
  return addDoc(tabsRef, { title: title.trim(), order: maxOrder + 1, type, createdAt: serverTimestamp() });
}

export function renameTab(tabId, title) {
  return updateDoc(doc(db, "tabs", tabId), { title: title.trim() });
}

export function setTabStats(tabId, stats) {
  return updateDoc(doc(db, "tabs", tabId), stats);
}

/** 탭 비밀번호 잠금 설정/해제 */
export function setTabLock(tabId, lockHash) {
  return updateDoc(doc(db, "tabs", tabId), { lockHash });
}

export async function swapTabOrder(tabA, tabB) {
  const batch = writeBatch(db);
  batch.update(doc(db, "tabs", tabA.id), { order: tabB.order });
  batch.update(doc(db, "tabs", tabB.id), { order: tabA.order });
  return batch.commit();
}

/** 탭 삭제 — 안에 속한 칼럼은 지우지 않고 미지정(tabId=null)으로 돌려 첫 탭에 보이게 한다. */
export async function deleteTab(tabId) {
  const colSnap = await getDocs(query(collection(db, "columns"), where("tabId", "==", tabId)));
  if (!colSnap.empty) {
    const batch = writeBatch(db);
    colSnap.docs.forEach((c) => batch.update(c.ref, { tabId: null }));
    await batch.commit();
  }
  return deleteDoc(doc(db, "tabs", tabId));
}
