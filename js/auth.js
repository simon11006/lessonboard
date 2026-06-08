// 세션(익명 uid)과 강사 모드 상태 관리
// ---------------------------------------------------------------------------
// 강사 비밀번호는 Firestore(config/teacher)에 해시로 저장됩니다(js/config.js).
// 이 모듈은 "현재 강사 모드인가"라는 메모리 상태만 다룹니다.
// 로그인이 없는 구조라 보호는 "소프트"(연수 현장 실수 방지) 수준입니다.
// ---------------------------------------------------------------------------

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

/** 강사 모드 on/off (비밀번호 검증은 js/config.js + ui.js 에서 처리) */
export function setTeacher(on) {
  teacherMode = !!on;
  notify();
}

export function exitTeacherMode() {
  setTeacher(false);
}

/** 강사 모드 변경 구독 (UI 갱신용) */
export function onTeacherModeChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  listeners.forEach((cb) => cb(teacherMode));
}
