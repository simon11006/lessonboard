// 강사 설정 마커 + 사이트 정보 (Firestore)
// ---------------------------------------------------------------------------
// 강사 인증은 Firebase Auth(강사 계정 로그인, js/firebase.js)가 서버에서
// 처리한다. config/teacher 문서는 "강사 비밀번호가 한 번이라도 설정됐는지"를
// 알리는 마커로만 쓴다 (최초 설정 vs 로그인 화면 구분용).
//   - 과거 버전이 저장한 passwordHash 필드도 마커로 인정(마이그레이션 호환).
// ---------------------------------------------------------------------------
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase.js";

const teacherRef = doc(db, "config", "teacher");
const siteRef = doc(db, "config", "site");

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 강사 비밀번호가 한 번이라도 설정됐는지 (최초 설정 화면 여부 판단용) */
export async function isTeacherPasswordSet() {
  const snap = await getDoc(teacherRef);
  if (!snap.exists()) return false;
  const d = snap.data();
  return d.setup === true || d.passwordHash != null;
}

/** 강사 비밀번호 설정 완료 마커 기록 */
export async function markTeacherSetup() {
  await setDoc(teacherRef, { setup: true, updatedAt: serverTimestamp() }, { merge: true });
}

/** 사이트 제목/부제 실시간 구독. cb({ title, kicker }) */
export function subscribeSiteInfo(cb) {
  return onSnapshot(siteRef, (snap) => {
    const d = snap.exists() ? snap.data() : {};
    cb({ title: d.title || null, kicker: d.kicker || null });
  });
}

/** 사이트 제목/부제 변경 (강사 전용). 전달된 필드만 반영 */
export function setSiteInfo({ title, kicker } = {}) {
  const data = { updatedAt: serverTimestamp() };
  if (title != null) data.title = title.trim();
  if (kicker != null) data.kicker = kicker.trim();
  return setDoc(siteRef, data, { merge: true });
}
