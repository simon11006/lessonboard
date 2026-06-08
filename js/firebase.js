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
  inMemoryPersistence,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);

/**
 * 익명 인증을 시작한다.
 * 세션 지속성을 inMemory 로 두어, 페이지를 새로고침/이탈하면 새로운 uid 가
 * 발급된다. → "페이지를 벗어나기 전까지만 본인 글 수정/삭제 가능" 동작의 핵심.
 * @returns {Promise<string>} 익명 사용자 uid
 */
export function initAuth() {
  return new Promise((resolve, reject) => {
    setPersistence(auth, inMemoryPersistence)
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
