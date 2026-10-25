# Mosaic (모자이크) — 주제별 보드 모음

패들렛·띵커벨 보드처럼 **주제마다 보드를 하나씩** 만들어 쓰는 게시판입니다. 관리자가
홈에서 보드를 만들고, 보드마다 생기는 **고유 링크**(`/#/b/보드ID`)를 참여자에게 공유합니다.
참여자는 로그인 없이 **이름만** 입력하고 글·사진·PDF·링크·댓글을 올립니다. 모두 **실시간** 반영.

### 보드 유형
| 유형 | 화면 |
|---|---|
| 그룹형 | 게시판(열)을 여러 개 두고 나눠 올림. 기존 "바이브코딩 연수 게시판"이 이 유형(기본 보드 `main`) |
| 격자형 | 같은 높이의 격자에 순서대로 |
| 타일형 | 글 길이대로 벽돌처럼 쌓임 |
| 스트림형 | 가운데 세로 한 줄 (드래그로 순서 변경) |
| 출석부형 | 참여자마다 지정된 칸. 만들 때 인원 수(예: 20)를 넣으면 1번~20번 칸 생성, 이름은 선택 |
| 지도형 | 지도(OpenStreetMap)에 위치를 찍고 글 남기기, 핀 드래그로 위치 이동 |

홈은 카드형·목록형·유형별 보기와 정렬(최근 활동·만든 순·이름)을 지원합니다.
새 보드 만들기·보드 설정·삭제·잠금은 관리자 비밀번호가 필요합니다.

### 데이터 구조
- `boards/{id}`: 보드 (title, description, type, roster, region, lockHash …)
- 기존 `tabs`·`columns`는 그대로 쓰고, 새 보드 소속이면 `boardId` 가 붙습니다.
  `boardId` 가 없는 탭/칼럼은 모두 기본 보드(`main`) 소속 → **기존 데이터는 옮기지 않습니다.**
- 그룹형이 아닌 보드는 글을 담는 보관용 칼럼 1개(`role: "board"`)를 가집니다
  → 카드·댓글·첨부·잠금·숨김 기능을 그대로 공유. 지도형 글은 `lat/lng`, 출석부형 글은 `rosterName` 필드를 가집니다.

> ⚠️ **배포 전 필수:** Firebase 콘솔 → Firestore → 규칙에 [`firestore.rules`](firestore.rules)를 다시 붙여넣고
> 게시하세요(`boards` 컬렉션 허용 추가). 게시 전에는 기존 보드만 보이고 새 보드를 만들 수 없습니다.

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
알림**에서 월 예산 알림을 설정해 두면 좋습니다. Storage 업로드는 규칙에서 20MB로 제한되어
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
js/boards.js          보드 CRUD · 유형 정의 · 글 수 집계
js/home.js            홈(보드 목록) · 새 보드 만들기 · 보드 설정
js/boardViews.js      격자·타일·스트림·출석부·지도형 화면
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
