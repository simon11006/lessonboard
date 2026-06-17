// 게시판 전체 백업 내보내기 (강사 모드)
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { cardFiles } from "./cards.js";

function tsToIso(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString();
}

/** 모든 칼럼 → 카드 → 댓글을 읽어 JSON 객체로 만든다. */
export async function buildBackup() {
  const columnsSnap = await getDocs(query(collection(db, "columns"), orderBy("order", "asc")));
  const columns = [];
  for (const colDoc of columnsSnap.docs) {
    const col = colDoc.data();
    const cardsSnap = await getDocs(query(collection(db, "columns", colDoc.id, "cards"), orderBy("order", "desc")));
    const cards = [];
    for (const cardDoc of cardsSnap.docs) {
      const card = cardDoc.data();
      const commentsSnap = await getDocs(query(collection(db, "columns", colDoc.id, "cards", cardDoc.id, "comments"), orderBy("createdAt", "asc")));
      const comments = commentsSnap.docs.map((c) => {
        const d = c.data();
        return { author: d.authorName, body: d.body, createdAt: tsToIso(d.createdAt) };
      });
      cards.push({
        title: card.title,
        body: card.body,
        isPrompt: card.isPrompt,
        files: cardFiles(card).map((f) => ({ url: f.url, type: f.type, name: f.name })),
        linkUrl: card.linkUrl,
        author: card.authorName,
        createdAt: tsToIso(card.createdAt),
        comments,
      });
    }
    columns.push({ title: col.title, writePermission: col.writePermission, cards });
  }
  return { exportedAt: new Date().toISOString(), columns };
}

/** 백업 JSON 파일을 다운로드한다. */
export async function downloadBackup() {
  const data = await buildBackup();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  a.href = url;
  a.download = `연수게시판-백업-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
