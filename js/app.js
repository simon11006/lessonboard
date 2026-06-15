// 앱 부트스트랩
import { startAuth, isTeacherUser } from "./firebase.js";
import { setUid, setTeacher } from "./auth.js";
import { ensureDefaultTab } from "./tabs.js";
import { initHeader, startBoard, showToast } from "./ui.js";

async function main() {
  initHeader();
  startBoard();
  try {
    // 인증 상태가 바뀔 때마다(로그인/강사 전환/새로고침) uid·강사 여부를 갱신.
    // 강사 여부는 Firebase 계정(강사 이메일 로그인)으로 서버에서 판별된다.
    const uid = await startAuth((user) => {
      setUid(user.uid);
      setTeacher(isTeacherUser(user));
    });
    setUid(uid);
    ensureDefaultTab().catch((e) => console.warn("기본 탭 생성 생략:", e.message));
  } catch (err) {
    console.error("초기화 실패:", err);
    document.querySelector("#board").innerHTML =
      `<div class="board__empty">Firebase 초기화에 실패했습니다.<br>js/firebase.js 의 설정값과 익명 인증 활성화를 확인하세요.<br><small>${err.message}</small></div>`;
    showToast("Firebase 설정을 확인하세요");
  }
}

main();
