// 강사 비밀번호 (Firestore 저장, SHA-256 해시)
// config/teacher 문서에 passwordHash 를 보관한다.
// 평문이 아니라 해시를 저장 → Firestore 읽기가 공개여도 비밀번호가 노출되지 않음.
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase.js";

const teacherRef = doc(db, "config", "teacher");
const siteRef = doc(db, "config", "site");

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 저장된 해시 (없으면 null) */
async function getTeacherHash() {
  const snap = await getDoc(teacherRef);
  return snap.exists() ? snap.data().passwordHash || null : null;
}

/** 비밀번호가 이미 설정돼 있는지 */
export async function isTeacherPasswordSet() {
  return (await getTeacherHash()) !== null;
}

/** 입력 비밀번호 검증 (아직 미설정이면 true) */
export async function verifyTeacherPassword(plain) {
  const stored = await getTeacherHash();
  if (!stored) return true;
  return (await sha256(plain)) === stored;
}

/** 비밀번호 설정/변경 */
export async function setTeacherPassword(plain) {
  const passwordHash = await sha256(plain);
  await setDoc(teacherRef, { passwordHash, updatedAt: serverTimestamp() }, { merge: true });
}

/** 사이트 제목 실시간 구독. cb(title|null) */
export function subscribeSiteTitle(cb) {
  return onSnapshot(siteRef, (snap) => {
    cb(snap.exists() ? snap.data().title || null : null);
  });
}

/** 사이트 제목 변경 (강사 전용) */
export function setSiteTitle(title) {
  return setDoc(siteRef, { title: title.trim(), updatedAt: serverTimestamp() }, { merge: true });
}
