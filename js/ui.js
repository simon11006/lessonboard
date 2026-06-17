// UI 렌더링: 칼럼/카드/모달/댓글/강사모드
import {
  subscribeColumns,
  addColumn,
  renameColumn,
  setColumnPermission,
  setColumnLayout,
  setColumnTab,
  setColumnNewCardPosition,
  setColumnGalleryCols,
  setColumnStats,
  setColumnLock,
  reorderColumns,
  deleteColumn,
} from "./columns.js";
import { subscribeTabs, addTab, renameTab, setTabStats, setTabLock, swapTabOrder, deleteTab } from "./tabs.js";
import { subscribeCards, addCard, updateCard, deleteCard, reorderCards, setCardLock, setCardHidden, copyCardTo, moveCardTo, cardFiles } from "./cards.js";
import { downloadBackup } from "./export.js";
import { subscribeComments, addComment, deleteComment, setCommentCount } from "./comments.js";
import { fetchLinkPreview, normalizeUrl } from "./linkPreview.js";
import {
  isTeacher,
  canManage,
  onTeacherModeChange,
} from "./auth.js";
import { teacherSignIn, teacherSignOut, teacherChangePassword } from "./firebase.js";
import { isTeacherPasswordSet, markTeacherSetup, subscribeSiteInfo, setSiteInfo, sha256 } from "./config.js";

// ---------- 작은 헬퍼들 ----------
const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.html != null) node.innerHTML = opts.html;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) {
    if (v != null && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  if (opts.on) for (const [evt, fn] of Object.entries(opts.on)) node.addEventListener(evt, fn);
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

// 본문 텍스트 안의 URL을 클릭 가능한 링크(새 창)로 바꿔 parent에 채워 넣는다.
// 텍스트 노드로 넣으므로 줄바꿈(pre-wrap)·XSS 안전성 모두 유지된다.
const URL_RE = /(https?:\/\/[^\s<]+)/g;
function appendLinkified(parent, text) {
  const str = String(text ?? "");
  let last = 0, m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(str))) {
    let url = m[0], trail = "";
    const tm = url.match(/[)\].,!?;:]+$/); // URL 뒤에 붙은 문장부호는 링크에서 제외
    if (tm) { trail = tm[0]; url = url.slice(0, -trail.length); }
    if (m.index > last) parent.appendChild(document.createTextNode(str.slice(last, m.index)));
    parent.appendChild(el("a", {
      class: "linkify",
      text: url,
      attrs: { href: url, target: "_blank", rel: "noopener noreferrer" },
      on: { click: (e) => e.stopPropagation() }, // 카드 클릭(상세 열기) 대신 링크만 열기
    }));
    if (trail) parent.appendChild(document.createTextNode(trail));
    last = m.index + m[0].length;
  }
  if (last < str.length) parent.appendChild(document.createTextNode(str.slice(last)));
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function fmtTime(ts) {
  if (!ts) return "방금";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "방금";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}.${dd} ${hh}:${mi}`;
}

let lastName = localStorage.getItem("vibe_board_name") || "";
function rememberName(name) {
  lastName = name;
  localStorage.setItem("vibe_board_name", name);
}

function normalizeParticipantName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function countUniqueParticipants(cards) {
  const names = new Set();
  cards.forEach((card) => {
    const name = normalizeParticipantName(card.authorName);
    if (name && name !== "익명") names.add(name);
  });
  return names.size;
}

function includesWebappText(value) {
  return String(value || "").includes("웹앱");
}

function tabForColumn(column) {
  return tabsCache.find((tab) => tab.id === column.tabId) || activeTab();
}

function isWebappPostingContext(column) {
  const tab = tabForColumn(column);
  return tab?.type === "webapp" || includesWebappText(tab?.title) || includesWebappText(column?.title);
}

function authorLabelForColumn(column) {
  const tab = tabForColumn(column);
  const titleText = `${tab?.title || ""} ${column?.title || ""}`;
  if (!isWebappPostingContext(column)) return "이름";
  return /학생|제작학생/.test(titleText) ? "제작학생" : "작성자";
}

function webappStatsPatch(cardCount, participantCount) {
  return {
    cardCount,
    webappCount: cardCount,
    webappsCount: cardCount,
    appCount: cardCount,
    participantCount,
    participants: participantCount,
    participantStudents: participantCount,
    studentParticipants: participantCount,
    studentCount: participantCount,
    authorCount: participantCount,
    makerCount: participantCount,
  };
}

function statsChanged(target, stats) {
  return Object.entries(stats).some(([key, value]) => Number(target?.[key] ?? 0) !== value);
}

async function syncWebappStats(tab, column, cards) {
  if (!tab || !column) return;
  const visibleCards = cards.filter((card) => !card.hidden);
  const stats = webappStatsPatch(visibleCards.length, countUniqueParticipants(visibleCards));

  try {
    const latestColumn = columnsCache.find((c) => c.id === column.id) || column;
    const latestTab = tabsCache.find((t) => t.id === tab.id) || tab;
    const updates = [];
    if (statsChanged(latestColumn, stats)) updates.push(setColumnStats(column.id, stats));
    if (statsChanged(latestTab, stats)) updates.push(setTabStats(tab.id, stats));
    if (updates.length) await Promise.all(updates);
  } catch (e) {
    console.warn("웹앱 통계 저장 실패", e);
  }
}

// ---------- 토스트 ----------
let toastTimer;
export function showToast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

// ---------- 모달 ----------
function openModal(content, { wide = false } = {}) {
  const overlay = el("div", {
    class: "modal-overlay",
    on: {
      click: (e) => {
        if (e.target === overlay) closeModal();
      },
    },
  });
  const modal = el("div", { class: "modal" + (wide ? " modal--wide" : "") }, content);
  overlay.appendChild(modal);
  $("#modal-root").appendChild(overlay);
  const onEsc = (e) => {
    if (e.key === "Escape") closeModal();
  };
  overlay._onEsc = onEsc;
  document.addEventListener("keydown", onEsc);
  return overlay;
}
function closeModal() {
  const root = $("#modal-root");
  const overlay = root.lastElementChild;
  if (overlay) {
    if (overlay._onEsc) document.removeEventListener("keydown", overlay._onEsc);
    if (overlay._cleanup) overlay._cleanup();
    overlay.remove();
  }
}

function modalHeader(title) {
  return el("div", { class: "modal__header" }, [
    el("h2", { text: title }),
    el("button", { class: "icon-btn", text: "✕", on: { click: closeModal } }),
  ]);
}

// ---------- 라이트박스 ----------
function openLightbox(src) {
  const lb = el("div", { class: "lightbox", on: { click: () => lb.remove() } }, [
    el("img", { attrs: { src } }),
  ]);
  document.body.appendChild(lb);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("프롬프트를 복사했습니다 📋");
  } catch {
    showToast("복사에 실패했습니다");
  }
}

// ---------- 보드 렌더 ----------
const boardEl = () => $("#board");
let columnsCache = [];
const cardUnsubs = new Map(); // columnId -> unsubscribe
let dragState = null; // { columnId, cardId, el } — 카드 드래그
let colDragState = null; // { columnId, el } — 칼럼(게시판) 헤더 드래그

// 드래그 중 마우스 Y 기준으로 어느 카드 뒤에 삽입할지 계산
function dragAfterElement(container, y) {
  const cards = [...container.querySelectorAll(".card:not(.dragging)")];
  let closest = { offset: -Infinity, el: null };
  for (const child of cards) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, el: child };
  }
  return closest.el;
}

// 칼럼 본문에 드래그 정렬 동작을 연결
function attachColumnDnD(body, column) {
  body.addEventListener("dragover", (e) => {
    if (!dragState || dragState.columnId !== column.id) return; // 같은 칼럼 내에서만
    e.preventDefault();
    body.classList.add("drag-over");
    const after = dragAfterElement(body, e.clientY);
    if (after == null) body.appendChild(dragState.el);
    else body.insertBefore(dragState.el, after);
  });
  body.addEventListener("dragleave", (e) => {
    if (!body.contains(e.relatedTarget)) body.classList.remove("drag-over");
  });
  body.addEventListener("drop", (e) => {
    if (!dragState || dragState.columnId !== column.id) return;
    e.preventDefault();
    body.classList.remove("drag-over");
    const orderedIds = [...body.querySelectorAll(".card")].map((c) => c.dataset.cardId);
    reorderCards(column.id, orderedIds).catch((err) => showToast("정렬 저장 실패: " + err.message));
  });
}

// 칼럼 드래그 중 마우스 X 기준으로 어느 칼럼 앞에 삽입할지 계산
function colDragAfterElement(board, x) {
  const cols = [...board.querySelectorAll(".column:not(.col-dragging)")];
  let closest = { offset: -Infinity, el: null };
  for (const child of cols) {
    const box = child.getBoundingClientRect();
    const offset = x - box.left - box.width / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, el: child };
  }
  return closest.el;
}

// 보드에 칼럼(게시판) 좌우 드래그 정렬 동작을 연결 (보드 요소는 유지되므로 1회만)
function attachBoardColumnDnD(board) {
  if (board._colDnD) return;
  board._colDnD = true;
  board.addEventListener("dragover", (e) => {
    if (!colDragState) return; // 칼럼 헤더 드래그 중에만
    e.preventDefault();
    const after = colDragAfterElement(board, e.clientX);
    if (after == null) board.appendChild(colDragState.el);
    else board.insertBefore(colDragState.el, after);
  });
}

// 칼럼 헤더를 드래그 핸들로 만들어 좌우 순서 변경 가능하게 한다 (강사용)
function attachColumnHeaderDrag(header, colEl, column) {
  header.setAttribute("draggable", "true");
  header.classList.add("column__header--draggable");
  header.addEventListener("dragstart", (e) => {
    colDragState = { columnId: column.id, el: colEl };
    colEl.classList.add("col-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", column.id);
  });
  header.addEventListener("dragend", () => {
    colEl.classList.remove("col-dragging");
    if (!colDragState) return;
    colDragState = null;
    const board = boardEl();
    const orderedIds = [...board.querySelectorAll(".column")].map((c) => c.dataset.columnId);
    // 보이는 칼럼들이 갖고 있던 order 값을 오름차순으로 모아 새 순서에 재매김
    const sortedVals = orderedIds
      .map((id) => columnsCache.find((c) => c.id === id)?.order ?? 0)
      .sort((a, b) => a - b);
    reorderColumns(orderedIds, sortedVals).catch((err) => showToast("정렬 저장 실패: " + err.message));
  });
}

let tabsCache = [];
let activeTabId = null;
let renderedColumns = [];

export function startBoard() {
  subscribeTabs((tabs) => {
    tabsCache = tabs;
    ensureActiveTab();
    renderAll();
  });
  subscribeColumns((columns) => {
    columnsCache = columns;
    renderAll();
  });
}

function ensureActiveTab() {
  if (!tabsCache.length) { activeTabId = null; return; }
  if (!tabsCache.some((t) => t.id === activeTabId)) activeTabId = tabsCache[0].id;
}

function activeTab() {
  return tabsCache.find((t) => t.id === activeTabId) || null;
}

/** 현재 탭에 보일 칼럼들 (탭이 없으면 전부, 미지정 칼럼은 첫 탭에 표시) */
function visibleColumns() {
  if (!tabsCache.length) return columnsCache;
  const firstTabId = tabsCache[0].id;
  return columnsCache.filter(
    (c) => c.tabId === activeTabId || (!c.tabId && activeTabId === firstTabId)
  );
}

function renderAll() {
  ensureActiveTab();
  renderTabs();
  renderBoard();
  // 웹앱 탭에서는 헤더의 '게시판 추가' 버튼을 숨긴다
  const at = activeTab();
  const addColBtn = $("#add-column-btn");
  if (addColBtn) addColBtn.hidden = !(isTeacher() && (!at || at.type !== "webapp"));
}

function renderTabs() {
  const bar = $("#tabbar");
  const teacher = isTeacher();
  bar.innerHTML = "";
  if (!tabsCache.length && !teacher) { bar.hidden = true; return; }
  bar.hidden = false;

  tabsCache.forEach((tab, idx) => {
    const active = tab.id === activeTabId;
    const group = el("div", { class: "tab-group" }, [
      el("button", {
        class: "tab" + (active ? " tab--active" : ""),
        on: { click: () => selectTab(tab) },
      }, [tab.title, tab.lockHash ? el("span", { class: "tab-lock-icon", text: "🔒" }) : null]),
    ]);
    if (teacher && active) {
      const tools = [];
      if (idx > 0) tools.push(el("button", { class: "icon-btn", text: "◀", attrs: { title: "왼쪽으로" }, on: { click: () => swapTabOrder(tab, tabsCache[idx - 1]) } }));
      if (idx < tabsCache.length - 1) tools.push(el("button", { class: "icon-btn", text: "▶", attrs: { title: "오른쪽으로" }, on: { click: () => swapTabOrder(tab, tabsCache[idx + 1]) } }));
      tools.push(el("button", { class: "icon-btn", text: tab.lockHash ? "🔒" : "🔓", attrs: { title: tab.lockHash ? "탭 잠금됨 (변경/해제)" : "탭 비밀번호 잠금" }, on: { click: () => openTabLock(tab) } }));
      tools.push(el("button", { class: "icon-btn", text: "✎", attrs: { title: "탭 이름 변경" }, on: { click: () => openTabRename(tab) } }));
      tools.push(el("button", { class: "icon-btn icon-btn--danger", text: "🗑", attrs: { title: "탭 삭제" }, on: { click: () => confirmDeleteTab(tab) } }));
      group.appendChild(el("span", { class: "tab-tools" }, tools));
    }
    bar.appendChild(group);
  });

  if (teacher) {
    bar.appendChild(el("button", { class: "tab-add", text: "＋ 탭", on: { click: openTabForm } }));
  }

  // 웹앱 탭이면 글쓰기 버튼을 탭 라인 우측에 둔다 (잠긴 탭은 제외)
  const at = activeTab();
  if (at && at.type === "webapp" && !isTabLocked(at)) {
    bar.appendChild(el("button", { class: "btn btn--primary tab-write", text: "＋ 글쓰기", on: { click: () => addWebappCard(at) } }));
  }
}

function renderBoard() {
  // 기존 카드 구독 해제
  cardUnsubs.forEach((u) => u());
  cardUnsubs.clear();

  const board = boardEl();
  board.innerHTML = "";

  const at = activeTab();

  // 잠긴 탭은 비밀번호 입력 전엔 내용을 보여주지 않는다.
  // (최초 로드 시 첫 탭이 자동 선택되는 경우에도 여기서 막아야 우회되지 않음)
  if (isTabLocked(at)) {
    board.classList.remove("board--webapp");
    board.appendChild(
      el("div", { class: "tab-locked-gate", on: { click: () => openTabUnlock(at) } }, [
        el("div", { class: "column__locked", attrs: { style: "max-width:360px;margin:auto" }, text: "🔒 비밀번호가 필요한 탭입니다. 눌러서 입력하세요." }),
      ])
    );
    return;
  }

  if (at && at.type === "webapp") {
    board.classList.add("board--webapp");
    renderWebappTab(at);
    return;
  }
  board.classList.remove("board--webapp");

  const columns = visibleColumns();
  renderedColumns = columns;

  if (!columns.length) {
    const msg = isTeacher()
      ? "‘＋ 게시판 추가’로 게시판을 만들어 보세요."
      : "아직 게시판이 없습니다. 강사가 곧 게시판을 만들 거예요.";
    board.appendChild(el("div", { class: "board__empty", text: msg }));
    return;
  }

  columns.forEach((column, idx) => {
    board.appendChild(buildColumn(column, idx, columns.length));
  });

  if (isTeacher()) attachBoardColumnDnD(board);
}

/** 웹앱 게시용 탭: 칼럼 없이 카드 갤러리로 직접 렌더 (암묵적 갤러리 칼럼 1개 사용) */
function renderWebappTab(tab) {
  const board = boardEl();
  const col = columnsCache.find((c) => c.tabId === tab.id);

  const gallery = el("div", { class: "webapp-gallery" });
  board.appendChild(gallery);

  const emptyMsg = () => el("div", { class: "board__empty", text: "아직 올라온 웹앱이 없습니다. ‘＋ 글쓰기’로 첫 작품을 올려보세요." });

  if (!col) {
    gallery.appendChild(emptyMsg());
    return;
  }

  attachColumnDnD(gallery, col);
  const unsub = subscribeCards(col.id, (allCards) => {
    const cards = isTeacher() ? allCards : allCards.filter((c) => !c.hidden);
    syncWebappStats(tab, col, allCards);
    gallery.innerHTML = "";
    if (!cards.length) {
      gallery.appendChild(emptyMsg());
      return;
    }
    cards.forEach((card, idx) => gallery.appendChild(buildCard(col, card, cards, idx)));
  });
  cardUnsubs.set(col.id, unsub);
}

/** 웹앱 탭에 카드 추가 (암묵적 갤러리 칼럼이 없으면 먼저 생성) */
async function addWebappCard(tab) {
  let col = columnsCache.find((c) => c.tabId === tab.id);
  if (!col) {
    try {
      const ref = await addColumn(tab.title || "웹앱", "all", "gallery", tab.id);
      col = { id: ref.id };
    } catch (e) {
      showToast("초기화 실패: " + e.message);
      return;
    }
  }
  openCardForm(col);
}

function buildColumn(column, index, total) {
  const teacher = isTeacher();
  const permTeacherOnly = column.writePermission === "teacher";
  const isGallery = column.layout === "gallery";
  const colLocked = !!column.lockHash && !teacher && !unlockedColumns.has(column.id);

  const tools = [];
  if (teacher) {
    tools.push(el("button", { class: "icon-btn", text: column.lockHash ? "🔒" : "🔓", attrs: { title: column.lockHash ? "게시판 잠금됨 (변경/해제)" : "게시판 비밀번호 잠금" }, on: { click: () => openColumnLock(column) } }));
    tools.push(el("button", { class: "icon-btn", text: "✎", attrs: { title: "설정" }, on: { click: () => openColumnSettings(column) } }));
    tools.push(el("button", { class: "icon-btn icon-btn--danger", text: "🗑", attrs: { title: "삭제" }, on: { click: () => confirmDeleteColumn(column) } }));
  }

  const countEl = el("span", { class: "column__count", text: "" });

  const canWrite = (!permTeacherOnly || teacher) && !colLocked;
  const headerAddBtn = canWrite
    ? el("button", {
        class: "btn btn--ghost btn--sm column__write",
        text: "＋ 글쓰기",
        on: { click: () => openCardForm(column) },
      })
    : null;

  // 제목 + 게시글 수 + 권한 배지를 한 묶음으로 (수는 제목 바로 옆)
  const titleWrap = el("div", { class: "column__titlewrap" }, [
    el("h2", { class: "column__title" }, [column.title, column.lockHash ? el("span", { class: "card__lock-icon", text: "🔒" }) : null]),
    countEl,
    permTeacherOnly ? el("span", { class: "column__perm column__perm--teacher", text: "강사" }) : null,
  ]);
  // 1줄차: 제목 + 게시글 수 + 글쓰기(오른쪽 끝)
  const headerMain = el("div", { class: "column__header-main" }, [
    titleWrap,
    el("span", { class: "column__spacer" }),
    headerAddBtn,
  ]);
  // 2줄차(강사): 잠금/설정/삭제 도구 — 글쓰기 아래로 내려 제목이 한 줄로 나오게
  const header = el("div", { class: "column__header" }, [
    headerMain,
    teacher ? el("div", { class: "column__toolbar" }, [el("div", { class: "column__tools" }, tools)]) : null,
  ]);

  const body = el("div", { class: "column__body" + (isGallery ? " column__body--gallery" : "") });

  const colEl = el("div", { class: "column" + (isGallery ? " column--gallery" : ""), attrs: { "data-column-id": column.id } }, [header, body]);

  // 강사: 헤더를 잡고 드래그해 좌우 순서 변경
  if (teacher) attachColumnHeaderDrag(header, colEl, column);

  if (isGallery) {
    // 갤러리: 칸 수만 지정. 각 카드 너비는 목록 게시판 카드와 동일하게 CSS가 계산
    colEl.style.setProperty("--gallery-cols", column.galleryCols || 3);
  }

  // 게시판 잠금: 비밀번호 입력 전엔 내용 숨김
  if (colLocked) {
    body.appendChild(el("div", { class: "column__locked", text: "🔒 비밀번호가 필요한 게시판입니다. 눌러서 입력하세요.", on: { click: () => openColumnUnlock(column) } }));
    return colEl;
  }

  attachColumnDnD(body, column);

  // 카드 실시간 구독
  const unsub = subscribeCards(column.id, (allCards) => {
    const cards = isTeacher() ? allCards : allCards.filter((c) => !c.hidden);
    countEl.textContent = cards.length ? `${cards.length}` : "";
    body.innerHTML = "";
    if (!cards.length) {
      body.appendChild(el("div", { class: "board__empty", attrs: { style: "padding:14px 4px;font-size:12.5px;" }, text: "아직 글이 없습니다." }));
    }
    cards.forEach((card, idx) => body.appendChild(buildCard(column, card, cards, idx)));
  });
  cardUnsubs.set(column.id, unsub);

  return colEl;
}

function buildCard(column, card, cards = [], index = 0) {
  const children = [];
  const isLocked = !!card.lockHash;
  const isEffectivelyLocked = isLocked && !isTeacher() && !unlockedCards.has(card.id);

  if (card.hidden) children.push(el("span", { class: "card__hidden-badge", text: "🙈 수강생에게 숨김" }));
  if (card.isPrompt && !isEffectivelyLocked) {
    const tagRow = [el("span", { class: "tag", attrs: { style: "margin:0" }, text: "프롬프트" })];
    if (card.body) {
      tagRow.push(el("button", {
        class: "btn btn--ghost btn--sm card__prompt-copy",
        text: "📋 복사",
        on: { click: (e) => { e.stopPropagation(); copyText(card.body); } },
      }));
    }
    children.push(el("div", { class: "card__prompt-head" }, tagRow));
  }
  if (card.title || isLocked) {
    children.push(el("h3", { class: "card__title" }, [
      card.title || "",
      isLocked ? el("span", { class: "card__lock-icon", text: "🔒", attrs: { title: "비밀번호 잠금" } }) : null,
    ]));
  }

  if (!isEffectivelyLocked) {
    if (card.body) {
      const bodyP = el("p", { class: "card__body card__body--clamp" });
      appendLinkified(bodyP, card.body);
      const moreHint = el("span", { class: "card__more-hint", text: "⋯ 더보기" });
      const bodyWrap = el("div", { class: "card__body-wrap" }, [bodyP, moreHint]);
      children.push(bodyWrap);
      requestAnimationFrame(() => {
        if (bodyP.scrollHeight - bodyP.clientHeight > 2) bodyWrap.classList.add("card__body-wrap--more");
      });
    }

    for (const f of cardFiles(card)) {
      if (!f.url) continue;
      if (f.type === "image") {
        children.push(
          el("div", { class: "card__media" }, [el("img", { attrs: { src: f.url, alt: f.name || "" } })])
        );
      } else {
        children.push(
          el("div", { class: "card__file" }, [
            el("span", { class: "card__file-icon", text: f.type === "pdf" ? "📄" : "📎" }),
            el("span", { class: "card__file-name", text: f.name || (f.type === "pdf" ? "PDF 교안" : "첨부 파일") }),
          ])
        );
      }
    }

    if (card.linkUrl) children.push(buildLinkPreview(card));
  }

  // footer
  const actions = [];
  // 강사: 숨김 토글 + 비밀번호 잠금
  if (isTeacher()) {
    const hiddenNow = !!card.hidden;
    actions.push(el("button", { class: "icon-btn", text: hiddenNow ? "🙈" : "👁", attrs: { title: hiddenNow ? "수강생에게 숨김 — 눌러서 다시 보이기" : "수강생에게 숨기기" }, on: { click: (e) => { e.stopPropagation(); setCardHidden(column.id, card.id, !hiddenNow).then(() => showToast(hiddenNow ? "다시 보입니다" : "수강생에게 숨겼습니다")).catch((err) => showToast("실패: " + err.message)); } } }));
    const lockedNow = !!card.lockHash;
    actions.push(el("button", { class: "icon-btn", text: lockedNow ? "🔒" : "🔓", attrs: { title: lockedNow ? "비밀번호 잠금됨 (변경/해제)" : "비밀번호 잠금" }, on: { click: (e) => { e.stopPropagation(); openCardLock(column, card); } } }));
    actions.push(el("button", { class: "icon-btn", text: "⇄", attrs: { title: "복사 / 이동" }, on: { click: (e) => { e.stopPropagation(); openCardMoveCopy(column, card); } } }));
  }
  if (canManage(card.authorUid)) {
    actions.push(el("button", { class: "icon-btn", text: "✎", attrs: { title: "수정" }, on: { click: (e) => { e.stopPropagation(); openCardForm(column, card); } } }));
    actions.push(el("button", { class: "icon-btn icon-btn--danger", text: "🗑", attrs: { title: "삭제" }, on: { click: (e) => { e.stopPropagation(); confirmDeleteCard(column, card); } } }));
  }

  const cmtCount = card.commentCount || 0;
  const meta = el("div", { class: "card__meta" }, [
    el("span", { class: "card__author", text: card.authorName || "익명" }),
    el("span", { class: "card__time", text: fmtTime(card.createdAt) }),
    el("span", {
      class: "card__comments-count" + (cmtCount ? " card__comments-count--has" : ""),
      text: cmtCount ? `💬 ${cmtCount}` : "💬",
      attrs: { title: cmtCount ? `댓글 ${cmtCount}개` : "댓글" },
    }),
  ]);
  // footer는 자동 줄바꿈: 도구가 한 줄에 안 들어가면 아래로 내려가 카드 밖으로 안 나감
  const footer = el("div", { class: "card__footer" }, [
    meta,
    actions.length ? el("div", { class: "card__actions" }, actions) : null,
  ]);
  children.push(footer);

  const cardEl = el("div", {
    class: "card" + (card.hidden ? " card--hidden" : ""),
    // 카드 순서 변경(드래그)은 모든 카드의 order 를 바꾸므로 강사만 가능
    attrs: { draggable: isTeacher() ? "true" : null, "data-card-id": card.id },
    on: {
      click: () => openCardDetail(column, card),
      dragstart: (e) => {
        dragState = { columnId: column.id, cardId: card.id, el: cardEl };
        cardEl.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.id);
      },
      dragend: () => {
        cardEl.classList.remove("dragging");
        dragState = null;
      },
    },
  }, children);
  return cardEl;
}

function buildLinkPreview(card) {
  const p = card.linkPreview;
  const href = normalizeUrl(card.linkUrl);
  const stop = (e) => e.stopPropagation();
  if (p) {
    // 이미지(사이트 첫 화면 썸네일)가 있으면 첨부파일처럼 보이는 제목/설명/주소 블록 없이
    // 미리보기 첫 화면만 보여준다.
    if (p.image) {
      return el("a", { class: "link-preview link-preview--imageonly", attrs: { href, target: "_blank", rel: "noopener" }, on: { click: stop } }, [
        el("img", { class: "link-preview__img", attrs: { src: p.image, alt: "", loading: "lazy" } }),
      ]);
    }
    // 이미지가 없을 때만 텍스트 메타 정보로 폴백.
    return el("a", { class: "link-preview", attrs: { href, target: "_blank", rel: "noopener" }, on: { click: stop } }, [
      el("div", { class: "link-preview__meta" }, [
        el("p", { class: "link-preview__title", text: p.title || href }),
        p.description ? el("p", { class: "link-preview__desc", text: p.description }) : null,
        el("p", { class: "link-preview__url", text: href }),
      ]),
    ]);
  }
  return el("a", { class: "link-preview", attrs: { href, target: "_blank", rel: "noopener" }, on: { click: stop } }, [
    el("div", { class: "link-preview__meta" }, [
      el("p", { class: "link-preview__title", text: "🔗 링크 열기" }),
      el("p", { class: "link-preview__url", text: href }),
    ]),
  ]);
}

// ---------- 카드 상세 + 댓글 ----------
// 이번 세션에서 비밀번호를 풀어 열람 허용된 카드 id
const unlockedCards = new Set();
const unlockedColumns = new Set();
const unlockedTabs = new Set();

// 공통: 비밀번호 잠금 설정/변경/해제 모달
function openLockEditor({ title, locked, hint, onSet, onRemove }) {
  const pw = el("input", { class: "input", attrs: { type: "password", placeholder: locked ? "새 비밀번호 (변경 시 입력)" : "비밀번호" } });
  const setBtn = el("button", { class: "btn btn--primary", text: locked ? "변경" : "잠금" });
  setBtn.addEventListener("click", async () => {
    const v = pw.value.trim();
    if (v.length < 2) return showToast("비밀번호를 입력하세요");
    setBtn.disabled = true;
    try {
      await onSet(await sha256(v));
      showToast(locked ? "비밀번호를 변경했습니다" : "잠갔습니다");
      closeModal();
    } catch (e) {
      showToast("저장 실패: " + e.message);
      setBtn.disabled = false;
    }
  });
  const footer = [el("button", { class: "btn btn--ghost", text: "취소", on: { click: closeModal } })];
  if (locked) {
    footer.push(el("button", {
      class: "btn btn--danger", text: "잠금 해제",
      on: { click: async () => { try { await onRemove(); showToast("잠금을 해제했습니다"); closeModal(); } catch (e) { showToast("실패: " + e.message); } } },
    }));
  }
  footer.push(setBtn);
  openModal([
    modalHeader(title),
    el("div", { class: "modal__body" }, [el("div", { class: "field" }, [el("label", { text: "비밀번호" }), pw, el("p", { class: "hint", text: hint })])]),
    el("div", { class: "modal__footer" }, footer),
  ]);
  pw.focus();
}

// 공통: 비밀번호 입력 모달
function openUnlockPrompt({ hashOf, onSuccess, label }) {
  const pw = el("input", { class: "input", attrs: { type: "password", placeholder: "비밀번호" } });
  const okBtn = el("button", { class: "btn btn--primary", text: "열기" });
  const tryOpen = async () => {
    okBtn.disabled = true;
    try {
      if ((await sha256(pw.value)) === hashOf) {
        closeModal();
        onSuccess();
      } else {
        showToast("비밀번호가 올바르지 않습니다");
        pw.value = "";
        pw.focus();
        okBtn.disabled = false;
      }
    } catch (e) { showToast("확인 실패: " + e.message); okBtn.disabled = false; }
  };
  okBtn.addEventListener("click", tryOpen);
  pw.addEventListener("keydown", (e) => { if (e.key === "Enter") tryOpen(); });
  openModal([
    modalHeader("🔒 비밀번호 입력"),
    el("div", { class: "modal__body" }, [el("div", { class: "field" }, [el("label", { text: label }), pw])]),
    el("div", { class: "modal__footer" }, [el("button", { class: "btn btn--ghost", text: "취소", on: { click: closeModal } }), okBtn]),
  ]);
  pw.focus();
}

function openColumnLock(column) {
  openLockEditor({
    title: column.lockHash ? "🔒 게시판 잠금 설정" : "🔒 게시판 잠그기",
    locked: !!column.lockHash,
    hint: column.lockHash ? "이 게시판은 잠겨 있습니다. 변경하거나 해제할 수 있어요." : "잠그면 수강생은 비밀번호를 입력해야 이 게시판을 볼 수 있어요. (강사는 바로 열람)",
    onSet: (h) => setColumnLock(column.id, h),
    onRemove: () => { unlockedColumns.delete(column.id); return setColumnLock(column.id, null); },
  });
}
function openColumnUnlock(column) {
  openUnlockPrompt({
    hashOf: column.lockHash,
    label: "이 게시판은 비밀번호로 보호되어 있습니다",
    onSuccess: () => { unlockedColumns.add(column.id); renderAll(); },
  });
}
function openTabLock(tab) {
  openLockEditor({
    title: tab.lockHash ? "🔒 탭 잠금 설정" : "🔒 탭 잠그기",
    locked: !!tab.lockHash,
    hint: tab.lockHash ? "이 탭은 잠겨 있습니다. 변경하거나 해제할 수 있어요." : "잠그면 수강생은 비밀번호를 입력해야 이 탭에 들어올 수 있어요. (강사는 바로 입장)",
    onSet: (h) => setTabLock(tab.id, h),
    onRemove: () => { unlockedTabs.delete(tab.id); return setTabLock(tab.id, null); },
  });
}
// 이 탭이 (지금 사용자에게) 잠겨 있는지 — 강사·이미 푼 탭은 잠금 아님
function isTabLocked(tab) {
  return !!(tab && tab.lockHash && !isTeacher() && !unlockedTabs.has(tab.id));
}
function openTabUnlock(tab) {
  openUnlockPrompt({
    hashOf: tab.lockHash,
    label: "이 탭은 비밀번호로 보호되어 있습니다",
    onSuccess: () => { unlockedTabs.add(tab.id); activeTabId = tab.id; renderAll(); },
  });
}
function selectTab(tab) {
  if (isTabLocked(tab)) {
    activeTabId = tab.id; // 활성 탭은 바꾸되, 내용은 렌더 단계에서 잠금 게이트로 막힘
    renderAll();          // 뒤로 잠금 게이트를 그린 뒤
    openTabUnlock(tab);   // 비밀번호 입력 모달을 띄움
    return;
  }
  activeTabId = tab.id;
  renderAll();
}

// 제목/로고 클릭 → 홈(첫 번째 탭)으로 이동
function goHome() {
  if (!tabsCache.length) return;
  selectTab(tabsCache[0]);
}

// 잠긴 글 열기 — 비밀번호 입력
function openCardUnlock(column, card) {
  const pw = el("input", { class: "input", attrs: { type: "password", placeholder: "비밀번호" } });
  const okBtn = el("button", { class: "btn btn--primary", text: "열기" });
  const tryOpen = async () => {
    okBtn.disabled = true;
    try {
      if ((await sha256(pw.value)) === card.lockHash) {
        unlockedCards.add(card.id);
        closeModal();
        renderAll(); // 미리보기 가림 해제
        openCardDetail(column, card);
      } else {
        showToast("비밀번호가 올바르지 않습니다");
        pw.value = "";
        pw.focus();
        okBtn.disabled = false;
      }
    } catch (e) {
      showToast("확인 실패: " + e.message);
      okBtn.disabled = false;
    }
  };
  okBtn.addEventListener("click", tryOpen);
  pw.addEventListener("keydown", (e) => { if (e.key === "Enter") tryOpen(); });
  openModal([
    modalHeader("🔒 비밀번호 입력"),
    el("div", { class: "modal__body" }, [
      el("div", { class: "field" }, [el("label", { text: "이 글은 비밀번호로 보호되어 있습니다" }), pw]),
    ]),
    el("div", { class: "modal__footer" }, [el("button", { class: "btn btn--ghost", text: "취소", on: { click: closeModal } }), okBtn]),
  ]);
  pw.focus();
}

// 강사: 글 비밀번호 설정/변경/해제
function openCardLock(column, card) {
  const locked = !!card.lockHash;
  const pw = el("input", { class: "input", attrs: { type: "password", placeholder: locked ? "새 비밀번호 (변경 시 입력)" : "비밀번호" } });
  const setBtn = el("button", { class: "btn btn--primary", text: locked ? "변경" : "잠금" });
  setBtn.addEventListener("click", async () => {
    const v = pw.value.trim();
    if (v.length < 2) return showToast("비밀번호를 입력하세요");
    setBtn.disabled = true;
    try {
      await setCardLock(column.id, card.id, await sha256(v));
      unlockedCards.delete(card.id);
      showToast(locked ? "비밀번호를 변경했습니다" : "글을 잠갔습니다");
      closeModal();
    } catch (e) {
      showToast("저장 실패: " + e.message);
      setBtn.disabled = false;
    }
  });
  const footer = [el("button", { class: "btn btn--ghost", text: "취소", on: { click: closeModal } })];
  if (locked) {
    footer.push(el("button", {
      class: "btn btn--danger", text: "잠금 해제",
      on: { click: async () => {
        try {
          await setCardLock(column.id, card.id, null);
          unlockedCards.delete(card.id);
          showToast("잠금을 해제했습니다");
          closeModal();
        } catch (e) { showToast("실패: " + e.message); }
      } },
    }));
  }
  footer.push(setBtn);
  openModal([
    modalHeader(locked ? "🔒 글 잠금 설정" : "🔒 글 잠그기"),
    el("div", { class: "modal__body" }, [
      el("div", { class: "field" }, [
        el("label", { text: "비밀번호" }), pw,
        el("p", { class: "hint", text: locked ? "잠긴 글입니다. 새 비밀번호로 변경하거나 잠금을 해제할 수 있어요." : "비밀번호를 걸면 연수생은 비밀번호를 입력해야 글을 볼 수 있어요. (강사는 바로 열람)" }),
      ]),
    ]),
    el("div", { class: "modal__footer" }, footer),
  ]);
  pw.focus();
}

function openCardDetail(column, card) {
  // 잠긴 글은 비밀번호 입력 후 열람 (강사·이미 연 글은 통과)
  if (card.lockHash && !isTeacher() && !unlockedCards.has(card.id)) {
    openCardUnlock(column, card);
    return;
  }

  const body = el("div", { class: "modal__body detail" });

  body.appendChild(
    el("div", { class: "detail__meta" }, [
      card.isPrompt ? el("span", { class: "tag", attrs: { style: "margin:0" }, text: "프롬프트" }) : null,
      el("span", { text: card.authorName || "익명" }),
      el("span", { text: "·" }),
      el("span", { text: fmtTime(card.createdAt) }),
      // 강사·본인: 상세에서 바로 수정
      canManage(card.authorUid)
        ? el("button", {
            class: "btn btn--ghost btn--sm detail__edit",
            text: "✎ 수정",
            on: { click: () => { closeModal(); openCardForm(column, card); } },
          })
        : null,
    ])
  );

  if (card.body) {
    const bodyWrap = el("div");
    const detailBody = el("div", { class: "detail__body" });
    appendLinkified(detailBody, card.body);
    bodyWrap.appendChild(detailBody);
    if (card.isPrompt)
      bodyWrap.appendChild(
        el("button", { class: "btn btn--ghost btn--sm", attrs: { style: "margin-top:10px" }, text: "📋 복사", on: { click: () => copyText(card.body) } })
      );
    body.appendChild(bodyWrap);
  }

  for (const f of cardFiles(card)) {
    if (!f.url) continue;
    if (f.type === "image") {
      body.appendChild(el("img", { class: "detail__image", attrs: { src: f.url }, on: { click: () => openLightbox(f.url) } }));
    } else {
      body.appendChild(
        el("div", { class: "card__file", attrs: { style: "margin-top:12px" } }, [
          el("span", { class: "card__file-icon", text: f.type === "pdf" ? "📄" : "📎" }),
          el("span", { class: "card__file-name", text: f.name || (f.type === "pdf" ? "PDF 교안" : "첨부 파일") }),
          el("a", { class: "btn btn--ghost btn--sm", attrs: { href: f.url, target: "_blank", rel: "noopener" }, text: "보기" }),
          el("a", { class: "btn btn--ghost btn--sm", attrs: { href: f.url, download: f.name || "", target: "_blank", rel: "noopener" }, text: "다운로드" }),
        ])
      );
    }
  }

  if (card.linkUrl) body.appendChild(buildLinkPreview(card));

  body.appendChild(el("div", { class: "detail__divider" }));

  // 댓글 영역
  const commentsWrap = el("div", { class: "comments" });
  const list = el("div", { class: "comments__list" });
  commentsWrap.appendChild(el("h3", { attrs: { style: "font-size:13px;margin:0 0 10px;color:var(--text-soft)" }, text: "댓글" }));
  commentsWrap.appendChild(list);

  // 댓글 입력
  const nameInput = el("input", { class: "input comment-name", attrs: { placeholder: "이름", value: lastName } });
  const bodyInput = el("input", { class: "input", attrs: { placeholder: "댓글을 입력하세요" } });
  const submit = el("button", { class: "btn btn--primary", text: "등록" });
  const send = async () => {
    const text = bodyInput.value.trim();
    if (!text) return;
    const name = nameInput.value.trim() || "익명";
    rememberName(name);
    bodyInput.value = "";
    try {
      await addComment(column.id, card.id, { body: text, authorName: name });
    } catch (e) {
      showToast("댓글 등록 실패: " + e.message);
    }
  };
  submit.addEventListener("click", send);
  bodyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });

  const form = el("div", { class: "comment-form" }, [
    el("div", { class: "comment-form__row" }, [nameInput, bodyInput]),
    el("div", { attrs: { style: "display:flex;justify-content:flex-end" } }, [submit]),
  ]);
  commentsWrap.appendChild(form);
  body.appendChild(commentsWrap);

  const overlay = openModal([modalHeader(card.title || "글 보기"), body], { wide: true });

  // 댓글 실시간 구독
  const unsub = subscribeComments(column.id, card.id, (comments) => {
    // 카드의 댓글 수 표시값을 실제 개수로 보정(추가/삭제 시 모두의 footer에 반영)
    if ((card.commentCount || 0) !== comments.length) {
      setCommentCount(column.id, card.id, comments.length).catch(() => {});
    }
    list.innerHTML = "";
    if (!comments.length) {
      list.appendChild(el("div", { class: "comments__empty", text: "첫 댓글을 남겨보세요." }));
      return;
    }
    comments.forEach((c) => {
      const del = canManage(c.authorUid)
        ? el("button", { class: "icon-btn icon-btn--danger", text: "🗑", attrs: { title: "삭제", style: "margin-left:auto" }, on: { click: () => deleteComment(column.id, card.id, c.id) } })
        : null;
      list.appendChild(
        el("div", { class: "comment" }, [
          el("div", { class: "comment__head" }, [
            el("span", { class: "comment__author", text: c.authorName || "익명" }),
            el("span", { class: "comment__time", text: fmtTime(c.createdAt) }),
            del,
          ]),
          el("div", { class: "comment__body", text: c.body }),
        ])
      );
    });
  });
  overlay._cleanup = unsub;
}

// ---------- 카드 작성/수정 폼 ----------
function openCardForm(column, existing = null) {
  const isEdit = !!existing;
  const isWebappPost = isWebappPostingContext(column);
  const authorLabel = authorLabelForColumn(column);
  const MAX_FILES = 3;
  // 첨부 허용 확장자 (이미지는 MIME 으로 별도 허용)
  const ALLOWED_EXT = ["pdf", "hwp", "hwpx", "txt", "ppt", "pptx", "xls", "xlsx", "doc", "docx", "csv"];
  const newFiles = [];                                   // 새로 추가한 File[]
  const keptFiles = isEdit ? cardFiles(existing).slice() : []; // 유지 중인 기존 첨부 엔트리[]
  const removedPaths = [];                               // 삭제 예정 기존 첨부 경로[]

  const nameInput = el("input", {
    class: "input",
    attrs: {
      placeholder: isWebappPost ? `${authorLabel} 이름` : "이름",
      value: isEdit ? existing.authorName : lastName,
      required: isWebappPost,
    },
  });
  const titleInput = el("input", { class: "input", attrs: { placeholder: "제목", value: isEdit ? existing.title || "" : "" } });
  const bodyInput = el("textarea", { class: "textarea textarea--lg", attrs: { placeholder: "내용을 입력하세요" } });
  bodyInput.value = isEdit ? existing.body || "" : "";
  const promptCheck = el("input", { attrs: { type: "checkbox", id: "is-prompt" } });
  if (isEdit && existing.isPrompt) promptCheck.checked = true;
  const linkInput = el("input", { class: "input", attrs: { placeholder: "https:// 참고 사이트 · 실습 사이트 주소 (선택)", value: isEdit ? existing.linkUrl || "" : "" } });
  const previewCheck = el("input", { attrs: { type: "checkbox", id: "show-preview" } });
  // 웹앱 게시용 탭에서는 새 글 작성 시 미리보기 표시를 기본으로 켠다.
  if (isEdit) {
    if (existing.linkPreview) previewCheck.checked = true;
  } else if (isWebappPost) {
    previewCheck.checked = true;
  }

  // 강사 전용: 비밀번호 잠금 설정
  const isAlreadyLocked = isEdit && !!existing.lockHash;
  const lockInput = isTeacher()
    ? el("input", { class: "input", attrs: { type: "password", placeholder: isAlreadyLocked ? "새 비밀번호 입력 시 변경, 비우면 기존 잠금 유지" : "비밀번호 (선택, 비우면 잠금 없음)" } })
    : null;
  const removeLockCheck = isTeacher() && isAlreadyLocked
    ? el("input", { attrs: { type: "checkbox", id: "remove-lock" } })
    : null;

  // 파일: 클립보드 붙여넣기 + 파일 선택 (최대 3개, 이미지/PDF/문서)
  const fileInput = el("input", {
    attrs: {
      type: "file",
      multiple: true,
      accept: "image/*,application/pdf,.hwp,.hwpx,.txt,.ppt,.pptx,.xls,.xlsx,.doc,.docx,.csv",
      style: "display:none",
    },
  });
  const chosen = el("div", { class: "file-chosen" });

  const totalCount = () => keptFiles.length + newFiles.length;

  function isAllowedFile(file) {
    if ((file.type || "").startsWith("image/")) return true;
    const ext = (file.name?.split(".").pop() || "").toLowerCase();
    return ext === "pdf" || ALLOWED_EXT.includes(ext);
  }

  // 첨부 목록(기존 + 신규)을 다시 그린다
  function renderChosen() {
    chosen.innerHTML = "";
    keptFiles.forEach((f, i) => {
      chosen.appendChild(fileChip(f.name, f.type, f.url, () => {
        if (f.path) removedPaths.push(f.path);
        keptFiles.splice(i, 1);
        renderChosen();
      }));
    });
    newFiles.forEach((file, i) => {
      const isImg = (file.type || "").startsWith("image/");
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
      const url = isImg ? URL.createObjectURL(file) : null;
      chosen.appendChild(fileChip(file.name, isImg ? "image" : isPdf ? "pdf" : "doc", url, () => {
        newFiles.splice(i, 1);
        renderChosen();
      }));
    });
  }

  function fileChip(name, type, url, onRemove) {
    if (type === "image" && url) {
      return el("div", { class: "paste-preview" }, [
        el("img", { attrs: { src: url } }),
        el("button", { class: "remove-file", text: "✕", attrs: { type: "button" }, on: { click: onRemove } }),
      ]);
    }
    return el("span", { class: "file-chosen__item" }, [
      el("span", { text: `${type === "pdf" ? "📄" : "📎"} ${name || "첨부 파일"}` }),
      el("button", { class: "btn btn--ghost btn--sm", text: "제거", attrs: { type: "button" }, on: { click: onRemove } }),
    ]);
  }

  // 파일들을 신규 첨부로 추가 (개수/형식/용량 검증)
  function addFiles(fileList) {
    for (const file of fileList) {
      if (!file) continue;
      if (totalCount() >= MAX_FILES) {
        showToast(`첨부는 최대 ${MAX_FILES}개까지 가능해요`);
        break;
      }
      if (!isAllowedFile(file)) {
        showToast("이미지·PDF·문서(hwp/hwpx·txt·ppt·excel·doc 등)만 첨부할 수 있어요");
        continue;
      }
      // 이미지는 업로드 전 자동 압축되므로 비이미지에만 20MB 제한 안내
      const isImg = (file.type || "").startsWith("image/");
      if (!isImg && file.size > 20 * 1024 * 1024) {
        showToast(`${file.name}: 파일은 20MB까지 첨부할 수 있어요`);
        continue;
      }
      newFiles.push(file);
    }
    renderChosen();
  }

  const pasteZone = el("div", {
    class: "paste-zone",
    text: "파일을 여기로 끌어다 놓거나, 이미지를 붙여넣기(Ctrl+V) 하거나, 클릭해 선택하세요 (이미지·PDF·문서, 최대 3개)",
    on: {
      click: () => fileInput.click(),
      dragover: (e) => {
        e.preventDefault();
        pasteZone.classList.add("paste-zone--active");
      },
      dragleave: () => pasteZone.classList.remove("paste-zone--active"),
      drop: (e) => {
        e.preventDefault();
        pasteZone.classList.remove("paste-zone--active");
        const files = e.dataTransfer?.files;
        if (files?.length) addFiles(files);
      },
    },
  });

  // 모달이 열려 있는 동안 어디서든 Ctrl+V 로 이미지 붙여넣기 허용
  const onPaste = (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item) {
      addFiles([item.getAsFile()]);
      pasteZone.classList.add("paste-zone--active");
      e.preventDefault();
    }
  };
  document.addEventListener("paste", onPaste);

  fileInput.addEventListener("change", () => {
    if (fileInput.files?.length) addFiles(fileInput.files);
    fileInput.value = ""; // 같은 파일 다시 선택 가능하도록 초기화
  });

  // 기존 첨부 표시 (수정 모드)
  renderChosen();

  const body = el("div", { class: "modal__body" }, [
    el("div", { class: "field" }, [
      el("label", {}, [
        authorLabel,
        isWebappPost ? el("span", { class: "required-mark", text: "*" }) : null,
      ]),
      nameInput,
    ]),
    el("div", { class: "field" }, [el("label", { text: "제목" }), titleInput]),
    el("div", { class: "field" }, [el("label", { text: "내용" }), bodyInput]),
    el("div", { class: "field" }, [
      el("div", { class: "checkbox-row" }, [promptCheck, el("label", { attrs: { for: "is-prompt" }, text: "복사버튼 추가" })]),
    ]),
    el("div", { class: "field" }, [
      el("label", { text: "링크" }),
      linkInput,
      el("div", { class: "checkbox-row", attrs: { style: "margin-top:8px" } }, [previewCheck, el("label", { attrs: { for: "show-preview" }, text: "미리보기 표시 (체크 안 하면 바로가기 주소만)" })]),
      el("p", { class: "hint", text: "미리보기를 켜면 사이트 첫 화면 썸네일이 생성됩니다 (실패 시 단순 링크)." }),
    ]),
    el("div", { class: "field" }, [el("label", { text: "파일 첨부 (이미지·PDF·문서, 최대 3개 · 각 20MB)" }), pasteZone, fileInput, chosen]),
    lockInput ? el("div", { class: "field" }, [
      el("label", { text: isAlreadyLocked ? "🔒 비밀번호 잠금 (설정됨)" : "🔒 비밀번호 잠금" }),
      lockInput,
      removeLockCheck ? el("div", { class: "checkbox-row", attrs: { style: "margin-top:8px" } }, [
        removeLockCheck,
        el("label", { attrs: { for: "remove-lock" }, text: "잠금 해제" }),
      ]) : null,
    ]) : null,
  ]);

  const saveBtn = el("button", { class: "btn btn--primary", text: isEdit ? "수정" : "등록" });
  const footer = el("div", { class: "modal__footer" }, [
    el("button", { class: "btn btn--ghost", text: "취소", on: { click: closeModal } }),
    saveBtn,
  ]);

  saveBtn.addEventListener("click", async () => {
    const rawName = nameInput.value.trim();
    if (isWebappPost && !rawName) {
      showToast(`${authorLabel} 이름을 입력해주세요`);
      nameInput.focus();
      return;
    }
    const name = rawName || "익명";
    const hasContent = titleInput.value.trim() || bodyInput.value.trim() || linkInput.value.trim() || newFiles.length || keptFiles.length;
    if (!hasContent) {
      showToast("제목·내용·링크·파일 중 하나는 입력해주세요");
      return;
    }
    rememberName(name);
    saveBtn.disabled = true;
    saveBtn.textContent = "저장 중…";
    try {
      // 링크 미리보기는 '미리보기 표시'를 켰을 때만 생성. 미체크면 바로가기 주소만.
      let linkPreview = null;
      const linkVal = linkInput.value.trim();
      const prevLink = isEdit ? existing.linkUrl || "" : "";
      if (linkVal && previewCheck.checked) {
        const reuse = isEdit && linkVal === prevLink && existing.linkPreview && existing.linkPreview.image;
        linkPreview = reuse ? existing.linkPreview : await fetchLinkPreview(linkVal);
      }

      const payload = {
        title: titleInput.value,
        body: bodyInput.value,
        isPrompt: promptCheck.checked,
        linkUrl: linkVal,
        linkPreview,
        authorName: name,
        files: newFiles,
      };

      let savedId;
      if (isEdit) {
        payload.keepFiles = keptFiles;
        payload.removedPaths = removedPaths;
        await updateCard(column.id, existing.id, payload);
        savedId = existing.id;
        showToast("수정했습니다");
      } else {
        payload.newCardPosition = column.newCardPosition; // 칼럼 설정에 따라 위/아래 삽입
        const ref = await addCard(column.id, payload);
        savedId = ref.id;
        showToast("등록했습니다");
      }

      // 강사 잠금 처리
      if (lockInput) {
        if (removeLockCheck?.checked) {
          await setCardLock(column.id, savedId, null);
          unlockedCards.delete(savedId);
        } else if (lockInput.value.trim()) {
          await setCardLock(column.id, savedId, await sha256(lockInput.value.trim()));
          unlockedCards.delete(savedId);
        }
      }

      closeModal();
    } catch (e) {
      showToast("저장 실패: " + e.message);
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? "수정" : "등록";
    }
  });

  const overlay = openModal([modalHeader(isEdit ? "글 수정" : "글쓰기"), body, footer], { wide: true });
  overlay._cleanup = () => document.removeEventListener("paste", onPaste);
}

// 강사: 글 복사 / 다른 게시판으로 이동 (탭 선택 → 게시판 선택 2단계)
function openCardMoveCopy(column, card) {
  const firstTabId = tabsCache[0] ? tabsCache[0].id : null;

  // 게시판 타입 탭만 (웹앱 탭은 칼럼이 없으므로 제외)
  const boardTabs = tabsCache.filter((t) => t.type !== "webapp");

  // 탭에 속한 칼럼 목록 (tabId 없는 칼럼은 첫 탭 소속)
  const getColsForTab = (tabId) =>
    columnsCache.filter((c) => c.tabId === tabId || (!c.tabId && tabId === firstTabId));

  if (!boardTabs.length) {
    openModal([
      modalHeader("글 복사 / 이동"),
      el("div", { class: "modal__body" }, [el("p", { text: "이동 가능한 게시판 탭이 없습니다." })]),
      el("div", { class: "modal__footer" }, [el("button", { class: "btn btn--ghost", text: "닫기", on: { click: closeModal } })]),
    ]);
    return;
  }

  // 현재 글이 속한 탭을 기본 선택
  const currentTabId = column.tabId || firstTabId;
  const defaultTab = boardTabs.find((t) => t.id === currentTabId) || boardTabs[0];

  const tabSel = el("select", { class: "select" },
    boardTabs.map((t) => el("option", { attrs: { value: t.id }, text: t.title }))
  );
  tabSel.value = defaultTab.id;

  const colSel = el("select", { class: "select" });
  const colField = el("div", { class: "field" }, [el("label", { text: "대상 게시판" }), colSel]);
  const hint = el("p", { class: "hint", text: "복사: 원본은 그대로 두고 사본 생성 · 이동: 원본을 옮김(댓글 포함)." });

  const updateCols = () => {
    const cols = getColsForTab(tabSel.value);
    colSel.innerHTML = "";
    if (!cols.length) {
      colSel.appendChild(el("option", { attrs: { disabled: "", value: "" }, text: "이 탭에 게시판이 없습니다" }));
      colField.style.display = "none";
    } else {
      cols.forEach((c) => colSel.appendChild(el("option", { attrs: { value: c.id }, text: c.title })));
      // 같은 탭이면 현재 게시판을 기본값으로
      colSel.value = cols.some((c) => c.id === column.id) ? column.id : cols[0].id;
      colField.style.display = "";
    }
  };
  tabSel.addEventListener("change", updateCols);
  updateCols();

  const run = async (mover, label) => {
    const target = colSel.value;
    if (!target) return showToast("대상 게시판을 선택하세요");
    closeModal();
    try {
      await mover(target);
      showToast(label);
    } catch (e) {
      showToast("실패: " + e.message);
    }
  };
  const copyBtn = el("button", { class: "btn btn--ghost", text: "복사", on: { click: () => run((t) => copyCardTo(column.id, card, t, { ownFile: false, withComments: false }), "복사했습니다") } });
  const moveBtn = el("button", { class: "btn btn--primary", text: "이동", on: { click: () => run((t) => moveCardTo(column.id, card, t), "이동했습니다") } });

  openModal([
    modalHeader("글 복사 / 이동"),
    el("div", { class: "modal__body" }, [
      el("div", { class: "field" }, [el("label", { text: "탭 선택" }), tabSel]),
      colField,
      hint,
    ]),
    el("div", { class: "modal__footer" }, [el("button", { class: "btn btn--ghost", text: "취소", on: { click: closeModal } }), copyBtn, moveBtn]),
  ]);
}

function confirmDeleteCard(column, card) {
  if (!confirm("이 글을 삭제할까요? 댓글과 첨부 파일도 함께 삭제됩니다.")) return;
  deleteCard(column.id, card)
    .then(() => showToast("삭제했습니다"))
    .catch((e) => showToast("삭제 실패: " + e.message));
}

// ---------- 칼럼 추가/설정 (강사) ----------
export function openColumnForm() {
  const titleInput = el("input", { class: "input", attrs: { placeholder: "게시판 이름 (예: 1일차 실습, Q&A, 참고자료)" } });
  const permSelect = el("select", { class: "select" }, [
    el("option", { attrs: { value: "all" }, text: "모두 글쓰기 가능" }),
    el("option", { attrs: { value: "teacher" }, text: "강사만 글쓰기 가능" }),
  ]);
  const layoutSelect = el("select", { class: "select" }, [
    el("option", { attrs: { value: "list" }, text: "목록 (좁은 세로 칼럼)" }),
    el("option", { attrs: { value: "gallery" }, text: "갤러리 (넓은 그리드 · 웹앱/이미지에 적합)" }),
  ]);
  const boardTabs = tabsCache.filter((t) => t.type !== "webapp");
  const tabSelect = boardTabs.length
    ? el("select", { class: "select" }, boardTabs.map((t) => el("option", { attrs: { value: t.id }, text: t.title })))
    : null;
  if (tabSelect) tabSelect.value = boardTabs.some((t) => t.id === activeTabId) ? activeTabId : boardTabs[0].id;
  const posSelect = el("select", { class: "select" }, [
    el("option", { attrs: { value: "top" }, text: "맨 위 (최신 글이 위로)" }),
    el("option", { attrs: { value: "bottom" }, text: "맨 아래 (최신 글이 아래로)" }),
  ]);
  const colsSelect = el("select", { class: "select" }, [
    el("option", { attrs: { value: "2" }, text: "2열" }),
    el("option", { attrs: { value: "3" }, text: "3열" }),
    el("option", { attrs: { value: "4" }, text: "4열" }),
  ]);
  colsSelect.value = "3";
  const colsField = el("div", { class: "field" }, [el("label", { text: "그리드 열 수" }), colsSelect]);
  const syncCols = () => { colsField.style.display = layoutSelect.value === "gallery" ? "" : "none"; };
  layoutSelect.addEventListener("change", syncCols);
  syncCols();

  const body = el("div", { class: "modal__body" }, [
    el("div", { class: "field" }, [el("label", { text: "게시판 이름" }), titleInput]),
    tabSelect ? el("div", { class: "field" }, [el("label", { text: "소속 탭" }), tabSelect]) : null,
    el("div", { class: "field" }, [el("label", { text: "글쓰기 권한" }), permSelect]),
    el("div", { class: "field" }, [el("label", { text: "보기 방식" }), layoutSelect]),
    colsField,
    el("div", { class: "field" }, [el("label", { text: "새 글 위치" }), posSelect]),
  ]);
  const saveBtn = el("button", { class: "btn btn--primary", text: "추가" });
  saveBtn.addEventListener("click", async () => {
    const title = titleInput.value.trim();
    if (!title) return showToast("게시판 이름을 입력하세요");
    try {
      await addColumn(title, permSelect.value, layoutSelect.value, tabSelect ? tabSelect.value : null, posSelect.value, Number(colsSelect.value));
      showToast("게시판을 추가했습니다");
      closeModal();
    } catch (e) {
      showToast("추가 실패: " + e.message);
    }
  });
  openModal([
    modalHeader("게시판 추가"),
    body,
    el("div", { class: "modal__footer" }, [el("button", { class: "btn btn--ghost", text: "취소", on: { click: closeModal } }), saveBtn]),
  ]);
  titleInput.focus();
}

function openColumnSettings(column) {
  const titleInput = el("input", { class: "input", attrs: { value: column.title } });
  const permSelect = el("select", { class: "select" }, [
    el("option", { attrs: { value: "all" }, text: "모두 글쓰기 가능" }),
    el("option", { attrs: { value: "teacher" }, text: "강사만 글쓰기 가능" }),
  ]);
  permSelect.value = column.writePermission || "all";
  const layoutSelect = el("select", { class: "select" }, [
    el("option", { attrs: { value: "list" }, text: "목록 (좁은 세로 칼럼)" }),
    el("option", { attrs: { value: "gallery" }, text: "갤러리 (넓은 그리드 · 웹앱/이미지에 적합)" }),
  ]);
  layoutSelect.value = column.layout || "list";

  const boardTabs = tabsCache.filter((t) => t.type !== "webapp");
  const curTab = column.tabId || (boardTabs[0] ? boardTabs[0].id : null);
  const tabSelect = boardTabs.length
    ? el("select", { class: "select" }, boardTabs.map((t) => el("option", { attrs: { value: t.id }, text: t.title })))
    : null;
  if (tabSelect) tabSelect.value = boardTabs.some((t) => t.id === curTab) ? curTab : boardTabs[0].id;
  const posSelect = el("select", { class: "select" }, [
    el("option", { attrs: { value: "top" }, text: "맨 위 (최신 글이 위로)" }),
    el("option", { attrs: { value: "bottom" }, text: "맨 아래 (최신 글이 아래로)" }),
  ]);
  posSelect.value = column.newCardPosition || "top";
  const colsSelect = el("select", { class: "select" }, [
    el("option", { attrs: { value: "2" }, text: "2열" }),
    el("option", { attrs: { value: "3" }, text: "3열" }),
    el("option", { attrs: { value: "4" }, text: "4열" }),
  ]);
  colsSelect.value = String(column.galleryCols || 3);
  const colsField = el("div", { class: "field" }, [el("label", { text: "그리드 열 수" }), colsSelect]);
  const syncCols = () => { colsField.style.display = layoutSelect.value === "gallery" ? "" : "none"; };
  layoutSelect.addEventListener("change", syncCols);
  syncCols();

  const body = el("div", { class: "modal__body" }, [
    el("div", { class: "field" }, [el("label", { text: "게시판 이름" }), titleInput]),
    tabSelect ? el("div", { class: "field" }, [el("label", { text: "소속 탭" }), tabSelect]) : null,
    el("div", { class: "field" }, [el("label", { text: "글쓰기 권한" }), permSelect]),
    el("div", { class: "field" }, [el("label", { text: "보기 방식" }), layoutSelect]),
    colsField,
    el("div", { class: "field" }, [el("label", { text: "새 글 위치" }), posSelect]),
  ]);
  const saveBtn = el("button", { class: "btn btn--primary", text: "저장" });
  saveBtn.addEventListener("click", async () => {
    const title = titleInput.value.trim();
    if (!title) return showToast("이름을 입력하세요");
    try {
      if (title !== column.title) await renameColumn(column.id, title);
      if (permSelect.value !== (column.writePermission || "all")) await setColumnPermission(column.id, permSelect.value);
      if (layoutSelect.value !== (column.layout || "list")) await setColumnLayout(column.id, layoutSelect.value);
      if (Number(colsSelect.value) !== (column.galleryCols || 3)) await setColumnGalleryCols(column.id, Number(colsSelect.value));
      if (tabSelect && tabSelect.value !== curTab) await setColumnTab(column.id, tabSelect.value);
      if (posSelect.value !== (column.newCardPosition || "top")) await setColumnNewCardPosition(column.id, posSelect.value);
      showToast("저장했습니다");
      closeModal();
    } catch (e) {
      showToast("저장 실패: " + e.message);
    }
  });
  openModal([
    modalHeader("게시판 설정"),
    body,
    el("div", { class: "modal__footer" }, [el("button", { class: "btn btn--ghost", text: "취소", on: { click: closeModal } }), saveBtn]),
  ]);
}

function confirmDeleteColumn(column) {
  if (!confirm(`게시판 '${column.title}'을(를) 삭제할까요? 안의 모든 글과 댓글이 함께 삭제됩니다.`)) return;
  deleteColumn(column.id)
    .then(() => showToast("게시판을 삭제했습니다"))
    .catch((e) => showToast("삭제 실패: " + e.message));
}

// ---------- 탭 관리 (강사) ----------
function openTabForm() {
  const titleInput = el("input", { class: "input", attrs: { placeholder: "탭 이름 (예: 강의용 게시판, 연수 실습 웹앱)" } });
  const typeSelect = el("select", { class: "select" }, [
    el("option", { attrs: { value: "board" }, text: "일반 게시판용 (여러 게시판을 두는 탭)" }),
    el("option", { attrs: { value: "webapp" }, text: "웹앱 게시용 (카드 갤러리 · 바로 글쓰기)" }),
  ]);
  const hint = el("p", { class: "hint", text: "일반: 탭 안에 게시판(칼럼)을 여러 개 만듭니다. 웹앱: 게시판 없이 카드 갤러리로 바로 작품을 올립니다." });
  typeSelect.addEventListener("change", () => {
    hint.textContent = typeSelect.value === "webapp"
      ? "웹앱: 게시판(칼럼) 없이 카드 갤러리로 동작합니다. 연수생이 바로 ‘＋ 글쓰기’로 웹앱을 올려요."
      : "일반: 탭 안에 게시판(칼럼)을 여러 개 만들어 교안·프롬프트·Q&A 등을 둡니다.";
  });

  const saveBtn = el("button", { class: "btn btn--primary", text: "추가" });
  saveBtn.addEventListener("click", async () => {
    const title = titleInput.value.trim();
    if (!title) return showToast("탭 이름을 입력하세요");
    saveBtn.disabled = true;
    try {
      const type = typeSelect.value;
      const ref = await addTab(title, type);
      // 웹앱 탭은 카드 갤러리용 칼럼을 자동 생성 → 바로 글쓰기 가능
      if (type === "webapp") await addColumn(title, "all", "gallery", ref.id);
      activeTabId = ref.id; // 새 탭으로 전환
      showToast("탭을 추가했습니다");
      closeModal();
    } catch (e) {
      showToast("추가 실패: " + e.message);
      saveBtn.disabled = false;
    }
  });
  openModal([
    modalHeader("탭 추가"),
    el("div", { class: "modal__body" }, [
      el("div", { class: "field" }, [el("label", { text: "탭 이름" }), titleInput]),
      el("div", { class: "field" }, [el("label", { text: "탭 종류" }), typeSelect, hint]),
    ]),
    el("div", { class: "modal__footer" }, [el("button", { class: "btn btn--ghost", text: "취소", on: { click: closeModal } }), saveBtn]),
  ]);
  titleInput.focus();
}

function openTabRename(tab) {
  const titleInput = el("input", { class: "input", attrs: { value: tab.title } });
  const saveBtn = el("button", { class: "btn btn--primary", text: "저장" });
  saveBtn.addEventListener("click", async () => {
    const title = titleInput.value.trim();
    if (!title) return showToast("이름을 입력하세요");
    try {
      await renameTab(tab.id, title);
      showToast("저장했습니다");
      closeModal();
    } catch (e) {
      showToast("저장 실패: " + e.message);
    }
  });
  openModal([
    modalHeader("탭 이름 변경"),
    el("div", { class: "modal__body" }, [el("div", { class: "field" }, [el("label", { text: "탭 이름" }), titleInput])]),
    el("div", { class: "modal__footer" }, [el("button", { class: "btn btn--ghost", text: "취소", on: { click: closeModal } }), saveBtn]),
  ]);
  titleInput.focus();
}

function confirmDeleteTab(tab) {
  const isWeb = tab.type === "webapp";
  const msg = isWeb
    ? `탭 '${tab.title}'을(를) 삭제할까요? 이 탭에 올라온 웹앱 카드도 함께 삭제됩니다.`
    : `탭 '${tab.title}'을(를) 삭제할까요? 탭 안의 게시판은 삭제되지 않고 첫 번째 탭으로 이동합니다.`;
  if (!confirm(msg)) return;
  (async () => {
    if (isWeb) {
      // 웹앱 탭의 암묵적 칼럼(들)과 카드까지 삭제
      const cols = columnsCache.filter((c) => c.tabId === tab.id);
      for (const c of cols) await deleteColumn(c.id);
    }
    await deleteTab(tab.id);
  })()
    .then(() => showToast("탭을 삭제했습니다"))
    .catch((e) => showToast("삭제 실패: " + e.message));
}

// ---------- 강사 모드 토글 ----------
async function openTeacherLogin() {
  let hasPassword;
  try {
    hasPassword = await isTeacherPasswordSet();
  } catch (e) {
    showToast("비밀번호 확인 실패: " + e.message);
    return;
  }

  // 최초 1회: 비밀번호 설정(= 강사 계정 생성)
  if (!hasPassword) {
    openSetPasswordModal({ firstTime: true });
    return;
  }

  // 이후: 비밀번호 입력 → 강사 계정으로 로그인 (강사 여부는 인증 리스너가 반영)
  const pwInput = el("input", { class: "input", attrs: { type: "password", placeholder: "강사 비밀번호" } });
  const okBtn = el("button", { class: "btn btn--primary", text: "확인" });
  const tryLogin = async () => {
    okBtn.disabled = true;
    try {
      await teacherSignIn(pwInput.value);
      showToast("강사 모드로 전환했습니다");
      closeModal();
    } catch (e) {
      showToast(e.code === "wrong-password" ? "비밀번호가 올바르지 않습니다" : "확인 실패: " + e.message);
      pwInput.value = "";
      pwInput.focus();
    } finally {
      okBtn.disabled = false;
    }
  };
  okBtn.addEventListener("click", tryLogin);
  pwInput.addEventListener("keydown", (e) => { if (e.key === "Enter") tryLogin(); });
  openModal([
    modalHeader("강사 모드"),
    el("div", { class: "modal__body" }, [
      el("div", { class: "field" }, [el("label", { text: "강사 비밀번호" }), pwInput, el("p", { class: "hint", text: "비밀번호를 입력하면 게시판 관리와 모든 글 삭제가 가능해집니다." })]),
    ]),
    el("div", { class: "modal__footer" }, [el("button", { class: "btn btn--ghost", text: "취소", on: { click: closeModal } }), okBtn]),
  ]);
  pwInput.focus();
}

// 비밀번호 설정/변경 모달
function openSetPasswordModal({ firstTime = false } = {}) {
  const pw1 = el("input", { class: "input", attrs: { type: "password", placeholder: "새 비밀번호" } });
  const pw2 = el("input", { class: "input", attrs: { type: "password", placeholder: "새 비밀번호 확인" } });
  const saveBtn = el("button", { class: "btn btn--primary", text: "저장" });

  const save = async () => {
    const a = pw1.value.trim();
    const b = pw2.value.trim();
    if (a.length < 6) return showToast("비밀번호는 6자 이상으로 정해주세요");
    if (a !== b) return showToast("두 비밀번호가 일치하지 않습니다");
    saveBtn.disabled = true;
    saveBtn.textContent = "저장 중…";
    try {
      if (firstTime) {
        await teacherSignIn(a);     // 강사 계정 생성 + 로그인
        await markTeacherSetup();   // 다음부턴 '로그인' 화면을 보여주도록 마커 기록
        showToast("강사 비밀번호를 설정했습니다");
      } else {
        await teacherChangePassword(a);
        showToast("비밀번호를 변경했습니다");
      }
      closeModal();
    } catch (e) {
      showToast("저장 실패: " + e.message);
      saveBtn.disabled = false;
      saveBtn.textContent = "저장";
    }
  };
  saveBtn.addEventListener("click", save);
  pw2.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });

  const footer = [saveBtn];
  if (!firstTime) footer.unshift(el("button", { class: "btn btn--ghost", text: "취소", on: { click: closeModal } }));

  openModal([
    modalHeader(firstTime ? "강사 비밀번호 설정" : "강사 비밀번호 변경"),
    el("div", { class: "modal__body" }, [
      firstTime
        ? el("p", { class: "hint", attrs: { style: "margin:0 0 14px" }, text: "이 비밀번호로 강사 전용 계정이 만들어지고, 다음부터 강사 모드 입장에 사용됩니다. (6자 이상)" })
        : null,
      el("div", { class: "field" }, [el("label", { text: "새 비밀번호" }), pw1]),
      el("div", { class: "field" }, [el("label", { text: "비밀번호 확인" }), pw2]),
    ]),
    el("div", { class: "modal__footer" }, footer),
  ]);
  pw1.focus();
}

// 게시판 제목/부제 수정 모달 (강사 전용)
function openEditTitleModal() {
  const kickerEl = $("#site-kicker");
  const titleEl = $("#site-title");
  const kickerInput = el("input", { class: "input", attrs: { type: "text", value: kickerEl.textContent.trim(), placeholder: "예: VIBE CODING · WORKSHOP" } });
  const titleInput = el("input", { class: "input", attrs: { type: "text", value: titleEl.textContent.trim() } });
  const saveBtn = el("button", { class: "btn btn--primary", text: "저장" });

  const save = async () => {
    const title = titleInput.value.trim();
    if (!title) return showToast("제목을 입력해주세요");
    saveBtn.disabled = true;
    try {
      await setSiteInfo({ title, kicker: kickerInput.value.trim() });
      showToast("제목을 변경했습니다");
      closeModal();
    } catch (e) {
      showToast("저장 실패: " + e.message);
      saveBtn.disabled = false;
    }
  };
  saveBtn.addEventListener("click", save);
  const onEnter = (e) => { if (e.key === "Enter") save(); };
  kickerInput.addEventListener("keydown", onEnter);
  titleInput.addEventListener("keydown", onEnter);

  openModal([
    modalHeader("게시판 제목 수정"),
    el("div", { class: "modal__body" }, [
      el("div", { class: "field" }, [el("label", { text: "부제 (상단 영문)" }), kickerInput]),
      el("div", { class: "field" }, [el("label", { text: "제목" }), titleInput]),
    ]),
    el("div", { class: "modal__footer" }, [el("button", { class: "btn btn--ghost", text: "취소", on: { click: closeModal } }), saveBtn]),
  ]);
  titleInput.focus();
  titleInput.select();
}

// ---------- 헤더 배선 ----------
export function initHeader() {
  const modeBtn = $("#teacher-mode-btn");
  const addColBtn = $("#add-column-btn");
  const exportBtn = $("#export-btn");
  const changePwBtn = $("#change-pw-btn");
  const badge = $("#teacher-badge");
  const editTitleBtn = $("#edit-title-btn");
  const titleEl = $("#site-title");
  const kickerEl = $("#site-kicker");

  changePwBtn.addEventListener("click", () => openSetPasswordModal({ firstTime: false }));

  // 게시판 제목/부제 (Firestore 연동, 강사가 수정 가능)
  subscribeSiteInfo(({ title, kicker }) => {
    if (title) {
      titleEl.textContent = title;
      document.title = title;
    }
    if (kicker) kickerEl.textContent = kicker;
  });
  editTitleBtn.addEventListener("click", openEditTitleModal);

  // 제목·로고를 누르면 홈(첫 탭)으로 돌아간다.
  const logoEl = $(".app-header__logo");
  [titleEl, logoEl].forEach((elm) => {
    if (!elm) return;
    elm.classList.add("is-home-link");
    elm.setAttribute("title", "홈으로");
    elm.addEventListener("click", goHome);
  });

  // 안내 배너 (한 번 닫으면 기억)
  const banner = $("#info-banner");
  const bannerClose = $("#info-banner-close");
  if (banner && !localStorage.getItem("vibe_board_banner_closed")) banner.hidden = false;
  bannerClose?.addEventListener("click", () => {
    banner.hidden = true;
    localStorage.setItem("vibe_board_banner_closed", "1");
  });

  exportBtn.addEventListener("click", async () => {
    exportBtn.disabled = true;
    const orig = exportBtn.textContent;
    exportBtn.textContent = "준비 중…";
    try {
      await downloadBackup();
      showToast("백업 파일을 내려받았습니다");
    } catch (e) {
      showToast("내보내기 실패: " + e.message);
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = orig;
    }
  });

  modeBtn.addEventListener("click", () => {
    if (isTeacher()) {
      modeBtn.disabled = true;
      teacherSignOut()
        .then(() => showToast("강사 모드를 종료했습니다"))
        .catch((e) => showToast("종료 실패: " + e.message))
        .finally(() => { modeBtn.disabled = false; });
    } else {
      openTeacherLogin();
    }
  });
  addColBtn.addEventListener("click", openColumnForm);

  onTeacherModeChange((on) => {
    badge.hidden = !on;
    addColBtn.hidden = !on;
    exportBtn.hidden = !on;
    changePwBtn.hidden = !on;
    editTitleBtn.hidden = !on;
    modeBtn.textContent = on ? "강사 모드 종료" : "강사 모드";
    renderAll(); // 권한에 따른 탭/버튼 재노출
  });
}
