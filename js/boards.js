// 보드(주제별 공간) CRUD + 실시간 구독
// 구조: 보드 → (그룹형) 탭 → 칼럼 → 카드 / (그 외 유형) 보관용 칼럼 1개 → 카드
// 기존 연수 게시판은 문서 없이도 존재하는 'main' 보드(그룹형)로 취급한다.
// boardId 가 없는 탭/칼럼은 모두 main 소속 → 기존 데이터는 옮기지 않는다.
import {
  collection,
  doc,
  addDoc,
  setDoc,
  deleteDoc,
  getDocs,
  getCountFromServer,
  onSnapshot,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { addColumn, deleteColumn } from "./columns.js";

export const MAIN_BOARD_ID = "main";

/** 보드 유형 정의 (홈 미리보기 색 · 설명) */
export const BOARD_TYPES = {
  group: { name: "그룹형", desc: "주제별 게시판(열)을 여러 개 두고 글을 나눠 올립니다.", bg: "#e6effb", dot: "#5b9be0" },
  grid: { name: "격자형", desc: "글이 같은 높이의 격자에 순서대로 놓입니다.", bg: "#fdf1dc", dot: "#eaa23a" },
  tile: { name: "타일형", desc: "글 길이에 맞춰 빈 공간 없이 벽돌처럼 쌓입니다.", bg: "#fde6ea", dot: "#e8697f" },
  stream: { name: "스트림형", desc: "글이 세로 한 줄로 이어집니다. 공지·발표 순서에 좋아요.", bg: "#e4f5f6", dot: "#3fb0b8" },
  roll: { name: "출석부형", desc: "참여자마다 자기 줄이 있어 각자 자리에 글을 씁니다.", bg: "#efe8fa", dot: "#9a72d6" },
  map: { name: "지도형", desc: "지도 위 원하는 위치에 핀을 꽂고 글을 남깁니다.", bg: "#e3f4ea", dot: "#4cb87e" },
};

/** 보드에 속한 문서인지 (boardId 없음 = main) */
export function belongsTo(item, boardId) {
  return (item.boardId || MAIN_BOARD_ID) === boardId;
}

/** 보드 실시간 구독. cb(boards[]) — main 문서가 없어도 호출측에서 기본값을 합친다 */
export function subscribeBoards(cb, onError) {
  return onSnapshot(
    collection(db, "boards"),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => onError && onError(err)
  );
}

/**
 * 보드를 만든다. 그룹형이 아니면 글을 담을 보관용 칼럼을 함께 만든다.
 * @param {object} data { title, description, type, roster?, region? }
 * @returns {Promise<string>} 새 보드 id
 */
export async function addBoard({ title, description = "", type, roster = [], region = "korea" }) {
  const payload = {
    title: title.trim(),
    description: description.trim(),
    type,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (type === "roll") payload.roster = roster;
  if (type === "map") payload.region = region;
  const ref = await addDoc(collection(db, "boards"), payload);
  if (type !== "group") {
    // 보관용 칼럼: 같은 카드/댓글/첨부 기능을 그대로 쓰기 위함
    await addColumn(payload.title, "all", "list", null, type === "stream" ? "bottom" : "top", 3, ref.id, "board");
  }
  return ref.id;
}

/** 보드 필드 일부 변경 (main 은 문서가 없을 수 있어 merge 로 쓴다) */
export function updateBoard(boardId, patch) {
  return setDoc(doc(db, "boards", boardId), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
}

/** 글이 올라오면 보드의 최근 활동 시각을 갱신 (실패해도 글쓰기는 막지 않음) */
export function touchBoard(boardId) {
  return setDoc(doc(db, "boards", boardId), { updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
}

/** 보드 삭제 — 소속 칼럼(글·댓글 포함)과 탭까지 정리. main 은 삭제하지 않는다 */
export async function deleteBoard(boardId) {
  if (boardId === MAIN_BOARD_ID) throw new Error("기본 보드는 삭제할 수 없습니다");
  const colSnap = await getDocs(query(collection(db, "columns"), where("boardId", "==", boardId)));
  for (const c of colSnap.docs) await deleteColumn(c.id);
  const tabSnap = await getDocs(query(collection(db, "tabs"), where("boardId", "==", boardId)));
  for (const t of tabSnap.docs) await deleteDoc(t.ref);
  return deleteDoc(doc(db, "boards", boardId));
}

/** 보드의 글 수 (칼럼별 집계 쿼리 합산) */
export async function countBoardCards(columnIds) {
  let total = 0;
  for (const id of columnIds) {
    const snap = await getCountFromServer(collection(db, "columns", id, "cards"));
    total += snap.data().count;
  }
  return total;
}

export function setBoardLock(boardId, lockHash) {
  return setDoc(doc(db, "boards", boardId), { lockHash }, { merge: true });
}
