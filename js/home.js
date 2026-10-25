// 홈(보드 목록) 화면 · 새 보드 만들기 · 보드 설정
import { el, openModal, closeModal, modalHeader, showToast, requireAdmin, openLockEditor, storageColumnOf } from "./ui.js";
import { isTeacher } from "./auth.js";
import { BOARD_TYPES, addBoard, updateBoard, deleteBoard, countBoardCards, setBoardLock, belongsTo } from "./boards.js";
import { setColumnPermission, setColumnNewCardPosition } from "./columns.js";

const VIEW_KEY = "mosaic_home_view"; // card | list | type
const SORT_KEY = "mosaic_home_sort"; // recent | name | created

function pref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 저장 불가 환경은 무시 */ }
}

/** 보드 고유 링크 (참여자에게 공유하는 주소) */
export function boardLink(boardId) {
  return `${location.origin}${location.pathname}#/b/${encodeURIComponent(boardId)}`;
}

// ---------- 날짜 ----------
function toDate(ts) {
  if (!ts) return null;
  return ts.toDate ? ts.toDate() : new Date(ts);
}
function fmtDate(ts) {
  const d = toDate(ts);
  if (!d) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
function fmtRelative(ts) {
  const d = toDate(ts);
  if (!d) return "방금";
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(d)) / 86400000);
  if (days <= 0) return "오늘";
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  return fmtDate(ts);
}
// 서버 시각이 아직 안 붙은 새 문서는 '지금'으로 취급
const timeOf = (ts) => toDate(ts)?.getTime() ?? Date.now();

// ---------- 유형별 미리보기 그림 ----------
const W = "background:#fff;border-radius:6px;";
const ART = {
  // 그룹형: 그룹(열) 사이를 세로줄로 나눈다
  group: `<div class="art art--row art--divided">
    <div class="art__col"><b class="art__head"></b><i style="height:24%;${W}"></i><i style="height:32%;${W}"></i></div>
    <div class="art__col"><b class="art__head"></b><i style="height:40%;${W}"></i><i style="height:18%;${W}"></i></div>
    <div class="art__col"><b class="art__head"></b><i style="height:18%;${W}"></i><i style="height:18%;${W}"></i><i style="height:18%;${W}"></i></div></div>`,
  grid: `<div class="art art--grid">${`<i style="${W}"></i>`.repeat(6)}</div>`,
  tile: `<div class="art art--row">
    <div class="art__col"><i style="height:45%;${W}"></i><i style="flex:1;${W}"></i></div>
    <div class="art__col"><i style="height:28%;${W}"></i><i style="flex:1;${W}"></i></div>
    <div class="art__col"><i style="flex:1;${W}"></i><i style="height:35%;${W}"></i></div></div>`,
  stream: `<div class="art art--stream"><i style="height:24%;${W}"></i><i style="height:30%;${W}"></i><i style="height:22%;${W}"></i></div>`,
  // 출석부형: 참여자마다 세로 칸 (맨 위 이름 + 그 아래 글)
  roll: `<div class="art art--row art--roll">${`<div class="art__col"><span class="art__who"><b></b><em></em></span><i style="height:38%;${W}"></i><i style="height:20%;${W}"></i></div>`.repeat(3)}</div>`,
  map: `<div class="art art--map"><span class="land land--a"></span><span class="land land--b"></span>
    <span class="pin" style="left:28%;top:30%"></span><span class="pin" style="left:50%;top:46%"></span><span class="pin" style="left:70%;top:58%"></span></div>`,
};

export function boardThumb(type, extraClass = "") {
  const t = BOARD_TYPES[type] || BOARD_TYPES.group;
  const node = el("div", { class: `hb-thumb ${extraClass}`, attrs: { style: `background:${t.bg}` } });
  node.innerHTML = ART[type] || ART.group;
  return node;
}

// ---------- 글 수 (보드별 집계, 30초 캐시) ----------
const countCache = new Map(); // boardId -> { sig, count, at }
function boardCount(board, columns) {
  const ids = columns.filter((c) => belongsTo(c, board.id)).map((c) => c.id);
  const sig = ids.join(",");
  const hit = countCache.get(board.id);
  if (hit && hit.sig === sig && Date.now() - hit.at < 30000) return hit.count;
  const entry = { sig, count: hit && hit.sig === sig ? hit.count : null, at: Date.now() };
  countCache.set(board.id, entry);
  countBoardCards(ids)
    .then((n) => {
      entry.count = n;
      document.querySelectorAll(`[data-count-for="${CSS.escape(board.id)}"]`).forEach((s) => (s.textContent = n));
    })
    .catch(() => {});
  return entry.count;
}

function sortBoards(boards, sort) {
  const list = [...boards];
  if (sort === "name") list.sort((a, b) => a.title.localeCompare(b.title, "ko"));
  else if (sort === "created") list.sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));
  else list.sort((a, b) => timeOf(b.updatedAt || b.createdAt) - timeOf(a.updatedAt || a.createdAt));
  return list;
}

// ---------- 홈 렌더 ----------
let lastArgs = null;

export function renderHome(container, args) {
  lastArgs = { container, args };
  const { boards, columns, boardsError } = args;
  const admin = isTeacher();
  const view = pref(VIEW_KEY, "card");
  const sort = pref(SORT_KEY, "recent");
  const sorted = sortBoards(boards, sort);

  container.innerHTML = "";
  const home = el("div", { class: "home" });

  if (boardsError && admin) {
    home.appendChild(el("div", { class: "home__notice", text: "⚠️ 새 보드를 저장할 곳(boards)에 접근할 수 없습니다. Firebase 콘솔 → Firestore → 규칙에 boards 컬렉션 허용을 추가한 뒤 게시해 주세요. (README 참고)" }));
  }

  const sortSel = el("select", { class: "home__sort", attrs: { "aria-label": "정렬" } }, [
    el("option", { attrs: { value: "recent" }, text: "최근 활동순" }),
    el("option", { attrs: { value: "created" }, text: "최근 만든 순" }),
    el("option", { attrs: { value: "name" }, text: "이름순" }),
  ]);
  sortSel.value = sort;
  sortSel.addEventListener("change", () => { savePref(SORT_KEY, sortSel.value); rerender(); });

  const seg = el("div", { class: "home__seg", attrs: { role: "group", "aria-label": "보기 방식" } },
    [["card", "▦ 카드형"], ["list", "☰ 목록형"], ["type", "◫ 유형별"]].map(([v, label]) =>
      el("button", {
        class: v === view ? "is-on" : "",
        text: label,
        attrs: { type: "button", "aria-pressed": v === view ? "true" : "false" },
        on: { click: () => { savePref(VIEW_KEY, v); rerender(); } },
      })
    )
  );

  home.appendChild(el("div", { class: "home__bar" }, [
    el("div", { class: "home__title" }, [el("h2", { text: "보드" }), el("span", { text: String(boards.length) })]),
    el("div", { class: "home__tools" }, [sortSel, seg]),
  ]));

  if (view === "list") home.appendChild(listView(sorted, columns, admin));
  else if (view === "type") typeView(sorted, columns, admin).forEach((n) => home.appendChild(n));
  else home.appendChild(el("div", { class: "hb-grid" }, [newBoardTile(), ...sorted.map((b) => boardCard(b, columns, admin))]));

  container.appendChild(home);
}

function rerender() {
  if (lastArgs) renderHome(lastArgs.container, lastArgs.args);
}

function newBoardTile() {
  return el("button", {
    class: "hb-new",
    attrs: { type: "button" },
    on: { click: () => requireAdmin(openCreateBoard) },
  }, [el("span", { class: "hb-new__plus", text: "+" }), el("span", { class: "hb-new__label", text: "새 보드 만들기" })]);
}

function metaLine(board, columns) {
  const t = BOARD_TYPES[board.type] || BOARD_TYPES.group;
  const count = boardCount(board, columns);
  return el("div", { class: "hb-meta" }, [
    el("i", { class: "hb-dot", attrs: { style: `background:${t.dot}` } }),
    `${t.name} · 글 `,
    el("span", { attrs: { "data-count-for": board.id }, text: count == null ? "…" : String(count) }),
    board.createdAt ? ` · ${fmtDate(board.createdAt)}` : "",
  ]);
}

function boardCard(board, columns, admin) {
  const thumb = boardThumb(board.type);
  if (board.lockHash) thumb.appendChild(el("span", { class: "hb-lock", text: "🔒" }));
  return el("a", { class: "hb-card", attrs: { href: `#/b/${encodeURIComponent(board.id)}` } }, [
    thumb,
    el("div", { class: "hb-head" }, [
      el("h3", { class: "hb-title", text: board.title }),
      admin ? menuButton(board) : null,
    ]),
    metaLine(board, columns),
  ]);
}

function listView(boards, columns, admin) {
  const rows = [
    el("div", { class: "hl-row hl-row--head" }, [
      el("span"), el("span", { text: "보드 이름" }), el("span", { text: "유형" }), el("span", { text: "글 수" }),
      el("span", { text: "만든 날" }), el("span", { text: "최근 활동" }), el("span"),
    ]),
    el("button", { class: "hl-row hl-row--new", attrs: { type: "button" }, on: { click: () => requireAdmin(openCreateBoard) } }, [
      el("span", { class: "hl-mini hl-mini--new", text: "+" }), el("span", { text: "새 보드 만들기" }),
    ]),
  ];
  boards.forEach((b) => {
    const t = BOARD_TYPES[b.type] || BOARD_TYPES.group;
    const count = boardCount(b, columns);
    rows.push(el("a", { class: "hl-row", attrs: { href: `#/b/${encodeURIComponent(b.id)}` } }, [
      boardThumb(b.type, "hl-mini"),
      el("span", { class: "hl-name" }, [b.title, b.lockHash ? " 🔒" : ""]),
      el("span", { class: "hl-muted" }, [el("i", { class: "hb-dot", attrs: { style: `background:${t.dot}` } }), t.name]),
      el("span", { class: "hl-muted", attrs: { "data-count-for": b.id }, text: count == null ? "…" : String(count) }),
      el("span", { class: "hl-muted", text: fmtDate(b.createdAt) }),
      el("span", { class: "hl-muted", text: fmtRelative(b.updatedAt || b.createdAt) }),
      admin ? menuButton(b) : el("span"),
    ]));
  });
  return el("div", { class: "hl" }, rows);
}

function typeView(boards, columns, admin) {
  const nodes = [el("div", { class: "hb-grid hb-grid--solo" }, [newBoardTile()])];
  Object.entries(BOARD_TYPES).forEach(([key, t]) => {
    const list = boards.filter((b) => b.type === key);
    if (!list.length) return;
    nodes.push(el("section", { class: "hg" }, [
      el("h3", { class: "hg__head" }, [el("i", { class: "hb-dot", attrs: { style: `background:${t.dot}` } }), t.name, el("span", { text: String(list.length) })]),
      el("div", { class: "hb-grid" }, list.map((b) => boardCard(b, columns, admin))),
    ]));
  });
  return nodes;
}

// ---------- 보드 메뉴 (관리자) ----------
function menuButton(board) {
  const btn = el("button", {
    class: "hb-menu",
    text: "⋯",
    attrs: { type: "button", title: "보드 관리", "aria-label": "보드 관리" },
    on: { click: (e) => { e.preventDefault(); e.stopPropagation(); openMenu(board, btn); } },
  });
  return btn;
}

function openMenu(board, anchor) {
  document.querySelector(".hb-pop")?.remove();
  const item = (text, fn, danger = false) =>
    el("button", { class: "hb-pop__item" + (danger ? " is-danger" : ""), text, attrs: { type: "button" }, on: { click: (e) => { e.preventDefault(); e.stopPropagation(); pop.remove(); fn(); } } });
  const pop = el("div", { class: "hb-pop" }, [
    item("🔗 링크 복사", async () => {
      try { await navigator.clipboard.writeText(boardLink(board.id)); showToast("보드 링크를 복사했습니다 🔗"); }
      catch { showToast("복사에 실패했습니다"); }
    }),
    board.isMain ? null : item("⚙ 보드 설정", () => openBoardSettings(board)),
    board.isMain ? null : item("🗑 보드 삭제", () => confirmDeleteBoard(board), true),
  ]);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + window.scrollY + 6}px`;
  pop.style.left = `${Math.max(12, r.right + window.scrollX - pop.offsetWidth)}px`;
  const close = (e) => {
    if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener("click", close, true); }
  };
  setTimeout(() => document.addEventListener("click", close, true));
}

function confirmDeleteBoard(board) {
  if (!confirm(`보드 '${board.title}'을(를) 삭제할까요? 안의 모든 글과 댓글이 함께 삭제됩니다.`)) return;
  deleteBoard(board.id)
    .then(() => {
      showToast("보드를 삭제했습니다");
      if (location.hash.startsWith("#/b/")) location.hash = "#/";
    })
    .catch((e) => showToast("삭제 실패: " + e.message));
}

// ---------- 참여자 명단 입력 (출석부형) ----------
function parseRoster(text) {
  const seen = new Set();
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s && !seen.has(s) && seen.add(s));
}

/** 1번~N번 칸 이름. 이름이 주어지면 '3번 김민지'처럼 붙이고, 이름이 더 많으면 그만큼 늘린다 */
function numberedRoster(count, names = []) {
  const n = Math.max(count || 0, names.length);
  return Array.from({ length: n }, (_, i) => (names[i] ? `${i + 1}번 ${names[i]}` : `${i + 1}번`));
}

function regionSelect(value = "korea") {
  const sel = el("select", { class: "select" }, [
    el("option", { attrs: { value: "korea" }, text: "대한민국" }),
    el("option", { attrs: { value: "world" }, text: "세계" }),
  ]);
  sel.value = value;
  return sel;
}

// ---------- 새 보드 만들기 ----------
export function openCreateBoard() {
  let type = "grid";
  const options = Object.entries(BOARD_TYPES).map(([key, t]) =>
    el("button", {
      class: "type-opt",
      attrs: { type: "button", "data-type": key, "aria-pressed": "false" },
      on: { click: () => { type = key; sync(); } },
    }, [
      boardThumb(key, "type-opt__thumb"),
      el("div", { class: "type-opt__name" }, [el("span", { class: "type-opt__radio" }), t.name]),
      el("p", { class: "type-opt__desc", text: t.desc }),
    ])
  );

  const titleInput = el("input", { class: "input", attrs: { placeholder: "보드 이름 (예: 독서 감상 나눔)" } });
  const descInput = el("input", { class: "input", attrs: { placeholder: "한 줄 설명 (선택)" } });
  // 출석부형: 인원 수만 넣으면 1번~N번 칸을 만든다. 이름은 적고 싶을 때만 (번호 순서대로)
  const countInput = el("input", { class: "input roster-count", attrs: { type: "number", min: "1", max: "200", value: "20", inputmode: "numeric" } });
  const rosterInput = el("textarea", { class: "textarea", attrs: { placeholder: "(선택) 1번부터 순서대로 한 줄에 한 명씩\n예)\n김민지\n이서준" } });
  const rosterField = el("div", { class: "field" }, [
    el("label", { text: "참여자 수" }),
    el("div", { class: "roster-count-row" }, [countInput, el("span", { text: "명 → 1번부터 번호 칸이 만들어져요" })]),
    el("label", { attrs: { style: "margin-top:14px" }, text: "이름 (선택)" }),
    rosterInput,
    el("p", { class: "hint", text: "이름을 적으면 ‘3번 김민지’처럼 번호 옆에 붙어요. 명단은 나중에 보드 설정에서 고칠 수 있어요." }),
  ]);
  const regionSel = regionSelect();
  const regionField = el("div", { class: "field" }, [el("label", { text: "처음 보여줄 지도" }), regionSel]);

  function sync() {
    options.forEach((o) => {
      const on = o.dataset.type === type;
      o.classList.toggle("is-on", on);
      o.setAttribute("aria-pressed", on ? "true" : "false");
    });
    rosterField.hidden = type !== "roll";
    regionField.hidden = type !== "map";
  }
  sync();

  const saveBtn = el("button", { class: "btn btn--primary", text: "만들기" });
  saveBtn.addEventListener("click", async () => {
    const title = titleInput.value.trim();
    if (!title) { titleInput.focus(); return showToast("보드 이름을 입력하세요"); }
    const count = Number(countInput.value);
    if (type === "roll" && !(count >= 1 && count <= 200)) { countInput.focus(); return showToast("참여자 수는 1~200 사이로 입력하세요"); }
    saveBtn.disabled = true;
    saveBtn.textContent = "만드는 중…";
    try {
      const id = await addBoard({
        title,
        description: descInput.value,
        type,
        roster: numberedRoster(count, parseRoster(rosterInput.value)),
        region: regionSel.value,
      });
      closeModal();
      showToast("보드를 만들었습니다");
      location.hash = `#/b/${encodeURIComponent(id)}`;
    } catch (e) {
      showToast("만들기 실패: " + e.message);
      saveBtn.disabled = false;
      saveBtn.textContent = "만들기";
    }
  });

  const overlay = openModal([
    modalHeader("새 보드 만들기"),
    el("div", { class: "modal__body" }, [
      el("div", { class: "field" }, [el("label", { text: "보드 유형" }), el("div", { class: "type-picker" }, options)]),
      el("div", { class: "field" }, [el("label", { text: "보드 이름" }), titleInput]),
      el("div", { class: "field" }, [el("label", { text: "설명" }), descInput]),
      rosterField,
      regionField,
    ]),
    el("div", { class: "modal__footer" }, [el("button", { class: "btn btn--ghost", text: "취소", on: { click: closeModal } }), saveBtn]),
  ]);
  overlay.querySelector(".modal").classList.add("modal--xl");
  titleInput.focus();
}

// ---------- 보드 설정 (관리자) ----------
export function openBoardSettings(board) {
  if (board.isMain) return;
  const typed = board.type !== "group";
  const column = typed ? storageColumnOf(board.id) : null;

  const titleInput = el("input", { class: "input", attrs: { value: board.title } });
  const descInput = el("input", { class: "input", attrs: { value: board.description || "", placeholder: "한 줄 설명 (선택)" } });

  const permSel = el("select", { class: "select" }, [
    el("option", { attrs: { value: "all" }, text: "모두 글쓰기 가능" }),
    el("option", { attrs: { value: "teacher" }, text: "관리자만 글쓰기 가능" }),
  ]);
  permSel.value = column?.writePermission || "all";
  const posSel = el("select", { class: "select" }, [
    el("option", { attrs: { value: "top" }, text: "맨 앞 (최신 글이 먼저)" }),
    el("option", { attrs: { value: "bottom" }, text: "맨 뒤 (최신 글이 나중)" }),
  ]);
  posSel.value = column?.newCardPosition || "top";

  const rosterInput = el("textarea", { class: "textarea", attrs: { placeholder: "한 줄에 한 칸씩 (예: 1번 김민지)" } });
  rosterInput.value = (board.roster || []).join("\n");
  // 인원 수를 바꾸면 끝에 번호 칸을 더하거나 뒤에서부터 줄인다
  const countAdj = el("input", { class: "input roster-count", attrs: { type: "number", min: "1", max: "200", value: String((board.roster || []).length || 20), inputmode: "numeric" } });
  const adjBtn = el("button", {
    class: "btn btn--ghost btn--sm",
    text: "칸 수 맞추기",
    attrs: { type: "button" },
    on: {
      click: () => {
        const n = Number(countAdj.value);
        if (!(n >= 1 && n <= 200)) return showToast("참여자 수는 1~200 사이로 입력하세요");
        const lines = parseRoster(rosterInput.value).slice(0, n);
        for (let i = lines.length; i < n; i++) lines.push(`${i + 1}번`);
        rosterInput.value = lines.join("\n");
      },
    },
  });
  const regionSel = regionSelect(board.region || "korea");

  const fields = [
    el("div", { class: "field" }, [el("label", { text: "보드 이름" }), titleInput]),
    el("div", { class: "field" }, [el("label", { text: "설명" }), descInput]),
    column ? el("div", { class: "field" }, [el("label", { text: "글쓰기 권한" }), permSel]) : null,
    column && ["grid", "tile", "stream"].includes(board.type) ? el("div", { class: "field" }, [el("label", { text: "새 글 위치" }), posSel]) : null,
    board.type === "roll"
      ? el("div", { class: "field" }, [
          el("label", { text: "참여자 수" }),
          el("div", { class: "roster-count-row" }, [countAdj, el("span", { text: "명" }), adjBtn]),
          el("label", { attrs: { style: "margin-top:14px" }, text: "참여자 명단 (한 줄에 한 칸)" }),
          rosterInput,
          el("p", { class: "hint", text: "‘3번’ → ‘3번 김민지’처럼 이름을 붙여도 그 칸의 글은 그대로 남아요. 명단에서 뺀 칸의 글은 지워지지 않고 ‘명단에 없는 글’ 칸에 모입니다." }),
        ])
      : null,
    board.type === "map" ? el("div", { class: "field" }, [el("label", { text: "처음 보여줄 지도" }), regionSel]) : null,
  ];

  const saveBtn = el("button", { class: "btn btn--primary", text: "저장" });
  saveBtn.addEventListener("click", async () => {
    const title = titleInput.value.trim();
    if (!title) return showToast("보드 이름을 입력하세요");
    saveBtn.disabled = true;
    try {
      const patch = { title, description: descInput.value.trim() };
      if (board.type === "roll") patch.roster = parseRoster(rosterInput.value);
      if (board.type === "map") patch.region = regionSel.value;
      await updateBoard(board.id, patch);
      if (column && permSel.value !== (column.writePermission || "all")) await setColumnPermission(column.id, permSel.value);
      if (column && posSel.value !== (column.newCardPosition || "top")) await setColumnNewCardPosition(column.id, posSel.value);
      showToast("저장했습니다");
      closeModal();
    } catch (e) {
      showToast("저장 실패: " + e.message);
      saveBtn.disabled = false;
    }
  });

  const lockBtn = el("button", {
    class: "btn btn--ghost",
    text: board.lockHash ? "🔒 잠금 변경" : "🔓 비밀번호 잠금",
    on: {
      click: () => {
        closeModal();
        openLockEditor({
          title: board.lockHash ? "🔒 보드 잠금 설정" : "🔒 보드 잠그기",
          locked: !!board.lockHash,
          hint: board.lockHash ? "이 보드는 잠겨 있습니다. 변경하거나 해제할 수 있어요." : "잠그면 참여자는 비밀번호를 입력해야 이 보드를 볼 수 있어요. (관리자는 바로 열람)",
          onSet: (h) => setBoardLock(board.id, h),
          onRemove: () => setBoardLock(board.id, null),
        });
      },
    },
  });
  const delBtn = el("button", { class: "btn btn--danger", text: "보드 삭제", on: { click: () => { closeModal(); confirmDeleteBoard(board); } } });

  openModal([
    modalHeader("보드 설정"),
    el("div", { class: "modal__body" }, fields),
    el("div", { class: "modal__footer modal__footer--split" }, [
      el("div", { class: "modal__footer-left" }, [delBtn, lockBtn]),
      el("button", { class: "btn btn--ghost", text: "취소", on: { click: closeModal } }),
      saveBtn,
    ]),
  ]);
  titleInput.focus();
}
