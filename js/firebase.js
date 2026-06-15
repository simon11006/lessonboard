// Firebase 초기화 (빌드 없는 ESM CDN 방식)
// ---------------------------------------------------------------------------
// ⚠️ 아래 firebaseConfig 값을 본인의 Firebase 프로젝트 설정으로 교체하세요.
//    (Firebase 콘솔 → 프로젝트 설정 → 일반 → 내 앱 → SDK 설정 및 구성)
//    웹 API 키는 공개되어도 정상입니다. 실제 보호는 보안 규칙으로 합니다.
//    설정 절차는 README.md 참고.
// ---------------------------------------------------------------------------

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserSessionPersistence,
  signInAnonymously,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updatePassword,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDIeT0Gio3qeARQxs6NRIfThmJt-EfB-1w",
  authDomain: "lessonboard-74832.firebaseapp.com",
  projectId: "lessonboard-74832",
  storageBucket: "lessonboard-74832.firebasestorage.app",
  messagingSenderId: "506643771460",
  appId: "1:506643771460:web:9f6cb114e3a9d4cb018c11",
  measurementId: "G-F24X8GJEL4",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);

// 강사 전용 계정 이메일. 비밀번호가 아니라 "식별자"라 공개돼도 무방하다.
// (실제 인증은 비밀번호이며 Firebase Auth 가 서버에서 검증한다.)
// 이 값은 firestore.rules 의 isTeacher() 와 반드시 동일해야 한다.
export const TEACHER_EMAIL = "teacher@lessonboard.app";

/** 사용자가 강사 계정(이메일/비번 로그인)인지 — 익명이 아니고 강사 이메일 */
export function isTeacherUser(user) {
  return !!user && !user.isAnonymous && user.email === TEACHER_EMAIL;
}

/**
 * 인증을 시작하고, 이후 인증 상태 변화를 onChange 로 흘려보낸다.
 *
 * 세션 지속성을 browserSession 으로 두어, 같은 브라우저 탭/창 안에서는
 * 새로고침해도 동일한 사용자가 유지되고(본인 글 수정/삭제·강사 모드 유지),
 * 창(탭)을 닫으면 사라진다.
 *
 * 이미 로그인된 사용자가 있으면(새로고침) 그대로 두고, 없을 때만 익명 로그인한다.
 * → 새로고침 시 강사 로그인을 익명으로 덮어쓰지 않도록 한다.
 *
 * @param {(user: import('firebase/auth').User) => void} onChange
 * @returns {Promise<string>} 최초 사용자 uid
 */
export function startAuth(onChange) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    setPersistence(auth, browserSessionPersistence)
      .then(() => {
        onAuthStateChanged(auth, (user) => {
          if (!user) {
            signInAnonymously(auth).catch(reject);
            return;
          }
          onChange(user);
          if (!resolved) {
            resolved = true;
            resolve(user.uid);
          }
        });
      })
      .catch(reject);
  });
}

/**
 * 강사 로그인. 강사 계정으로 로그인하고, 계정이 아직 없으면(최초/마이그레이션)
 * 입력한 비밀번호로 계정을 생성한다.
 *  - 계정 있음 + 비번 맞음 → 로그인 성공
 *  - 계정 없음           → 생성(= 최초 설정)
 *  - 계정 있음 + 비번 틀림 → 생성 시도 시 email-already-in-use → "비번 오류"
 */
export async function teacherSignIn(password) {
  try {
    await signInWithEmailAndPassword(auth, TEACHER_EMAIL, password);
  } catch (_) {
    try {
      await createUserWithEmailAndPassword(auth, TEACHER_EMAIL, password);
    } catch (e2) {
      if (e2.code === "auth/email-already-in-use") {
        const err = new Error("비밀번호가 올바르지 않습니다");
        err.code = "wrong-password";
        throw err;
      }
      throw e2;
    }
  }
}

/** 강사 모드 종료 = 다시 익명 사용자로 전환 */
export function teacherSignOut() {
  return signInAnonymously(auth);
}

/** 강사 비밀번호 변경 (현재 강사로 로그인된 상태여야 함) */
export function teacherChangePassword(newPassword) {
  if (!auth.currentUser) return Promise.reject(new Error("로그인이 필요합니다"));
  return updatePassword(auth.currentUser, newPassword);
}
