// 세션(익명 uid)과 강사 모드 상태 관리
// ---------------------------------------------------------------------------
// ⚠️ 강사 암호를 아래에서 변경하세요. 로그인이 없는 구조라 이 암호는 "소프트"
//    보호(연수 현장에서 실수 방지) 수준입니다. README.md 의 보안 안내 참고.
// ---------------------------------------------------------------------------

const TEACHER_PASSWORD = "vibe2026";

let currentUid = null;
let teacherMode = false;
const listeners = new Set();

export function setUid(uid) {
  currentUid = uid;
}

export function getUid() {
  return currentUid;
}

/** 카드/댓글의 작성자가 현재 세션 사용자인지 (= 페이지 이탈 전 본인 글) */
export function isMine(authorUid) {
  return !!currentUid && authorUid === currentUid;
}

export function isTeacher() {
  return teacherMode;
}

/** 현재 사용자가 해당 글을 수정/삭제할 수 있는지 (본인이거나 강사) */
export function canManage(authorUid) {
  return isMine(authorUid) || teacherMode;
}

/**
 * 강사 암호를 검증해 강사 모드를 켠다.
 * @returns {boolean} 성공 여부
 */
export function enterTeacherMode(password) {
  if (password === TEACHER_PASSWORD) {
    teacherMode = true;
    notify();
    return true;
  }
  return false;
}

export function exitTeacherMode() {
  teacherMode = false;
  notify();
}

/** 강사 모드 변경 구독 (UI 갱신용) */
export function onTeacherModeChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  listeners.forEach((cb) => cb(teacherMode));
}
