// 앱 부트스트랩
import { initAuth } from "./firebase.js";
import { setUid, restoreTeacher } from "./auth.js";
import { initHeader, startBoard, showToast } from "./ui.js";

async function main() {
  initHeader();
  try {
    const uid = await initAuth();
    setUid(uid);
    startBoard();
    restoreTeacher(); // 새로고침해도 강사 모드 유지
  } catch (err) {
    console.error("초기화 실패:", err);
    document.querySelector("#board").innerHTML =
      `<div class="board__empty">Firebase 초기화에 실패했습니다.<br>js/firebase.js 의 설정값과 익명 인증 활성화를 확인하세요.<br><small>${err.message}</small></div>`;
    showToast("Firebase 설정을 확인하세요");
  }
}

main();
