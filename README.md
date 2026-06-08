# 바이브코딩 연수 게시판 (패들렛 스타일)

연수용 패들렛 스타일 게시판입니다. 강사가 게시판(칼럼)을 자유롭게 만들고, 교안 PDF·
복사용 프롬프트·참고 사이트를 올립니다. 연수생은 로그인 없이 **이름만** 입력하고
실습 사이트 공유·스크린샷 Q&A·댓글에 참여합니다. 글/댓글은 **실시간**으로 반영됩니다.

- **데이터:** Firebase Firestore (실시간) · **파일:** Firebase Storage
- **인증:** Firebase 익명 인증 (세션 지속성 off)
- **빌드:** 없음 — 순수 HTML/CSS/JS + Firebase CDN(ESM)
- **배포:** Netlify (정적)

## 주요 기능
- 강사 모드(암호): 게시판 추가/이름변경/순서변경/삭제, 게시판별 글쓰기 권한(모두/강사만), 모든 글·댓글 삭제, **백업 내보내기**
- 카드 한 장에 자유 조합: 제목 + 본문 + **복사용 프롬프트** + **PDF/이미지 첨부** + **링크 미리보기**
- 이미지 **클립보드 붙여넣기(Ctrl+V)** → Q&A 스크린샷 질문에 편리
- 이미지 **업로드 전 자동 압축**(긴 변 1600px) → 빠른 로딩·용량 절약
- **카드 드래그 정렬**(같은 게시판 안에서 순서 변경). 콘텐츠 수정은 본인만 가능
- 모든 카드에 **댓글**(= Q&A 답변, 실습물 피드백)
- 연수생은 **페이지를 벗어나기 전까지** 본인 글·댓글을 수정/삭제 (새로고침/이탈 시 익명 세션이 바뀌어 권한 소멸). 상단 안내 배너로 고지

---

## 1) Firebase 설정

1. [Firebase 콘솔](https://console.firebase.google.com)에서 프로젝트 생성.
2. **빌드 → Authentication → 시작하기 → 로그인 방법 → 익명(Anonymous) 사용 설정**.
3. **빌드 → Firestore Database → 데이터베이스 만들기** (프로덕션 모드, 리전 선택).
4. **빌드 → Storage → 시작하기**.
5. **프로젝트 설정(⚙️) → 일반 → 내 앱 → 웹 앱 추가(`</>`)** 후 표시되는
   `firebaseConfig` 값을 복사해 [`js/firebase.js`](js/firebase.js)의 `firebaseConfig`에 붙여넣기.
6. **강사 암호 변경:** [`js/auth.js`](js/auth.js)의 `TEACHER_PASSWORD` 값을 원하는 암호로 수정.

### 보안 규칙 배포
- Firestore: 콘솔 **Firestore → 규칙** 탭에 [`firestore.rules`](firestore.rules) 내용을 붙여넣고 게시.
- Storage: 콘솔 **Storage → 규칙** 탭에 [`storage.rules`](storage.rules) 내용을 붙여넣고 게시.

> ⚠️ **보안 안내:** 로그인이 없는 게시판이라 강사 암호는 클라이언트에서만 확인하는
> "소프트" 보호입니다(연수 현장의 실수 방지 수준). 본인 글 수정/삭제는 익명 세션 uid로
> 규칙에서도 강제됩니다. 단, ① 삭제는 강사의 '모든 글 삭제'를 지원하기 위해 인증
> 사용자에게 열려 있고, ② 드래그 정렬을 위해 `order` 필드만큼은 누구나 변경할 수
> 있습니다(본문 등 다른 내용은 본인만 수정 가능). 민감한 데이터는 올리지 마세요.

### 비용 보호 (권장)
연수 그룹 내부에서만 쓰면 악용 위험은 낮지만, 안전하게 Firebase 콘솔 **결제 → 예산 및
알림**에서 월 예산 알림을 설정해 두면 좋습니다. Storage 업로드는 규칙에서 10MB로 제한되어
있고, 이미지는 업로드 전 자동 압축됩니다.

---

## 2) 로컬 실행

ES 모듈을 쓰므로 `file://`로 직접 열면 안 되고 간단한 정적 서버가 필요합니다.

```bash
# 아무거나 하나
npx serve .
python -m http.server 8000
```

브라우저에서 `http://localhost:8000` 접속. 콘솔에 Firebase 오류가 없는지 확인하세요.

---

## 3) Netlify 배포

**방법 A — 드래그&드롭(가장 빠름)**
1. [app.netlify.com](https://app.netlify.com) → **Add new site → Deploy manually**.
2. 이 폴더 전체를 드롭.

**방법 B — Git 연동**
1. 이 폴더를 GitHub 저장소에 올리고 Netlify에서 연결.
2. 빌드 명령은 비움, publish 디렉터리는 `.` ([`netlify.toml`](netlify.toml)에 설정됨).

**배포 후:** Firebase 콘솔 **Authentication → 설정 → 승인된 도메인**에
Netlify 도메인(예: `your-site.netlify.app`)을 추가해야 익명 로그인이 동작합니다.

---

## 파일 구조
```
index.html            화면 골격
css/styles.css        차분한 전문가형 테마
js/firebase.js        Firebase 초기화 · 익명 로그인  ← 설정값 입력
js/auth.js            세션 uid · 강사 모드           ← 강사 암호 변경
js/columns.js         게시판(칼럼) CRUD · 실시간
js/cards.js           카드 CRUD · 파일 업로드 · 정렬 · 실시간
js/comments.js        댓글 CRUD · 실시간
js/imageUtil.js       이미지 업로드 전 자동 압축
js/linkPreview.js     링크 미리보기(microlink.io)
js/export.js          백업 내보내기(JSON)
js/ui.js              렌더링 · 모달 · 강사모드 · 드래그 정렬
js/app.js             부트스트랩
firestore.rules       Firestore 보안 규칙
storage.rules         Storage 보안 규칙
netlify.toml          Netlify 정적 배포 설정
```

## 참고
- 링크 미리보기는 [microlink.io](https://microlink.io) 무료 API를 클라이언트에서 호출합니다.
  무료 한도(월 50건/일부 제한)를 넘으면 미리보기 없이 단순 링크로 표시됩니다.
- PDF는 카드에서 "보기"(새 탭)·"다운로드"로 제공됩니다.
