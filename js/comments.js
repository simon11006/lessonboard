// 댓글(= Q&A 답변, 실습물 피드백) CRUD + 실시간 구독
import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { getUid } from "./auth.js";

const commentsCol = (columnId, cardId) =>
  collection(db, "columns", columnId, "cards", cardId, "comments");

/** 댓글 실시간 구독 (오래된 순). cb(comments[]) */
export function subscribeComments(columnId, cardId, cb) {
  const q = query(commentsCol(columnId, cardId), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function addComment(columnId, cardId, { body, authorName }) {
  return addDoc(commentsCol(columnId, cardId), {
    body: body.trim(),
    authorName: authorName?.trim() || "익명",
    authorUid: getUid(),
    createdAt: serverTimestamp(),
  });
}

export function deleteComment(columnId, cardId, commentId) {
  return deleteDoc(doc(db, "columns", columnId, "cards", cardId, "comments", commentId));
}
