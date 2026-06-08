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

/**
 * 익명 인증을 시작한다.
 * 세션 지속성을 browserSession 으로 두어, 같은 브라우저 탭/창 안에서는
 * 새로고침해도 동일한 uid 가 유지되고, 창(탭)을 닫으면 사라진다.
 * → "창을 닫기 전까지 본인 글 수정/삭제 가능" 동작의 핵심.
 * @returns {Promise<string>} 익명 사용자 uid
 */
export function initAuth() {
  return new Promise((resolve, reject) => {
    setPersistence(auth, browserSessionPersistence)
      .then(() => {
        const unsub = onAuthStateChanged(auth, (user) => {
          if (user) {
            unsub();
            resolve(user.uid);
          }
        });
        return signInAnonymously(auth);
      })
      .catch(reject);
  });
}
