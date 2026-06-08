// UI 렌더링: 칼럼/카드/모달/댓글/강사모드
import {
  subscribeColumns,
  addColumn,
  renameColumn,
  setColumnPermission,
  setColumnLayout,
  setColumnTab,
  swapColumnOrder,
  deleteColumn,
} from "./columns.js";
import { subscribeTabs, addTab, renameTab, swapTabOrder, deleteTab } from "./tabs.js";
import { subscribeCards, addCard, updateCard, deleteCard, reorderCards } from "./cards.js";
import { downloadBackup } from "./export.js";
import { subscribeComments, addComment, deleteComment } from "./comments.js";
import { fetchLinkPreview, normalizeUrl } from "./linkPreview.js";
import {
  isTeacher,
  canManage,
  setTeacher,
  exitTeacherMode,
  onTeacherModeChange,
} from "./auth.js";
import { isTeacherPasswordSet, verifyTeacherPassword, setTeacherPassword } from "./config.js";

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
let dragState = null; // { columnId, cardId, el }

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
        text: tab.title,
        on: { click: () => { activeTabId = tab.id; renderAll(); } },
      }),
    ]);
    if (teacher && active) {
      const tools = [];
      if (idx > 0) tools.push(el("button", { class: "icon-btn", text: "◀", attrs: { title: "왼쪽으로" }, on: { click: () => swapTabOrder(tab, tabsCache[idx - 1]) } }));
      if (idx < tabsCache.length - 1) tools.push(el("button", { class: "icon-btn", text: "▶", attrs: { title: "오른쪽으로" }, on: { click: () => swapTabOrder(tab, tabsCache[idx + 1]) } }));
      tools.push(el("button", { class: "icon-btn", text: "✎", attrs: { title: "탭 이름 변경" }, on: { click: () => openTabRename(tab) } }));
      tools.push(el("button", { class: "icon-btn icon-btn--danger", text: "🗑", attrs: { title: "탭 삭제" }, on: { click: () => confirmDeleteTab(tab) } }));
      group.appendChild(el("span", { class: "tab-tools" }, tools));
    }
    bar.appendChild(group);
  });

  if (teacher) {
    bar.appendChild(el("button", { class: "tab-add", text: "＋ 탭", on: { click: openTabForm } }));
  }
}

function renderBoard() {
  // 기존 카드 구독 해제
  cardUnsubs.forEach((u) => u());
  cardUnsubs.clear();

  const board = boardEl();
  board.innerHTML = "";

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
}

function buildColumn(column, index, total) {
  const teacher = isTeacher();
  const permTeacherOnly = column.writePermission === "teacher";
  const isGallery = column.layout === "gallery";

  const tools = [];
  if (teacher) {
    if (index > 0)
      tools.push(el("button", { class: "icon-btn", text: "◀", attrs: { title: "왼쪽으로" }, on: { click: () => swapColumnOrder(column, renderedColumns[index - 1]) } }));
    if (index < total - 1)
      tools.push(el("button", { class: "icon-btn", text: "▶", attrs: { title: "오른쪽으로" }, on: { click: () => swapColumnOrder(column, renderedColumns[index + 1]) } }));
    tools.push(el("button", { class: "icon-btn", text: "✎", attrs: { title: "설정" }, on: { click: () => openColumnSettings(column) } }));
    tools.push(el("button", { class: "icon-btn icon-btn--danger", text: "🗑", attrs: { title: "삭제" }, on: { click: () => confirmDeleteColumn(column) } }));
  }

  const countEl = el("span", { class: "column__count", text: "" });
  const header = el("div", { class: "column__header" }, [
    el("h2", { class: "column__title", text: column.title }),
    permTeacherOnly ? el("span", { class: "column__perm column__perm--teacher", text: "강사" }) : null,
    countEl,
    el("div", { class: "column__tools" }, tools),
  ]);

  const body = el("div", { class: "column__body" + (isGallery ? " column__body--gallery" : "") });
  attachColumnDnD(body, column);

  const canWrite = !permTeacherOnly || teacher;
  const addBtn = canWrite
    ? el("button", {
        class: "btn btn--ghost btn--block column__add",
        text: "＋ 글쓰기",
        on: { click: () => openCardForm(column) },
      })
    : null;

  const colEl = el("div", { class: "column" + (isGallery ? " column--gallery" : "") }, [header, body, addBtn]);

  // 카드 실시간 구독
  const unsub = subscribeCards(column.id, (cards) => {
    countEl.textContent = cards.length ? `${cards.length}` : "";
    body.innerHTML = "";
    if (!cards.length) {
      body.appendChild(el("div", { class: "board__empty", attrs: { style: "padding:14px 4px;font-size:12.5px;" }, text: "아직 글이 없습니다." }));
    }
    cards.forEach((card) => body.appendChild(buildCard(column, card)));
  });
  cardUnsubs.set(column.id, unsub);

  return colEl;
}

function buildCard(column, card) {
  const children = [];

  if (card.isPrompt) children.push(el("span", { class: "tag", text: "프롬프트" }));
  if (card.title) children.push(el("h3", { class: "card__title", text: card.title }));

  if (card.body)
    children.push(el("p", { class: "card__body card__body--clamp", text: card.body }));

  if (card.fileType === "image" && card.fileUrl) {
    children.push(
      el("div", { class: "card__media" }, [el("img", { attrs: { src: card.fileUrl, alt: card.fileName || "" } })])
    );
  } else if (card.fileType === "pdf" && card.fileUrl) {
    children.push(
      el("div", { class: "card__file" }, [
        el("span", { class: "card__file-icon", text: "📄" }),
        el("span", { class: "card__file-name", text: card.fileName || "PDF 교안" }),
      ])
    );
  }

  if (card.linkUrl) children.push(buildLinkPreview(card));

  if (card.isPrompt && card.body) {
    children.push(
      el("button", {
        class: "btn btn--ghost btn--sm card__prompt-copy",
        text: "📋 복사",
        on: {
          click: (e) => {
            e.stopPropagation();
            copyText(card.body);
          },
        },
      })
    );
  }

  // footer
  const actions = [];
  if (canManage(card.authorUid)) {
    actions.push(el("button", { class: "icon-btn", text: "✎", attrs: { title: "수정" }, on: { click: (e) => { e.stopPropagation(); openCardForm(column, card); } } }));
    actions.push(el("button", { class: "icon-btn icon-btn--danger", text: "🗑", attrs: { title: "삭제" }, on: { click: (e) => { e.stopPropagation(); confirmDeleteCard(column, card); } } }));
  }

  const footer = el("div", { class: "card__footer" }, [
    el("span", { class: "card__author", text: card.authorName || "익명" }),
    el("span", { class: "card__time", text: fmtTime(card.createdAt) }),
    el("span", { class: "card__spacer" }),
    el("span", { class: "card__comments-count", text: "💬" }),
    el("div", { class: "card__actions" }, actions),
  ]);
  children.push(footer);

  const cardEl = el("div", {
    class: "card",
    attrs: { draggable: "true", "data-card-id": card.id },
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
    return el("a", { class: "link-preview", attrs: { href, target: "_blank", rel: "noopener" }, on: { click: stop } }, [
      p.image ? el("img", { class: "link-preview__img", attrs: { src: p.image, alt: "", loading: "lazy" } }) : null,
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
function openCardDetail(column, card) {
  const body = el("div", { class: "modal__body detail" });

  body.appendChild(
    el("div", { class: "detail__meta" }, [
      card.isPrompt ? el("span", { class: "tag", attrs: { style: "margin:0" }, text: "프롬프트" }) : null,
      el("span", { text: card.authorName || "익명" }),
      el("span", { text: "·" }),
      el("span", { text: fmtTime(card.createdAt) }),
    ])
  );

  if (card.body) {
    const bodyWrap = el("div");
    bodyWrap.appendChild(el("div", { class: "detail__body", text: card.body }));
    if (card.isPrompt)
      bodyWrap.appendChild(
        el("button", { class: "btn btn--ghost btn--sm", attrs: { style: "margin-top:10px" }, text: "📋 복사", on: { click: () => copyText(card.body) } })
      );
    body.appendChild(bodyWrap);
  }

  if (card.fileType === "image" && card.fileUrl) {
    body.appendChild(el("img", { class: "detail__image", attrs: { src: card.fileUrl }, on: { click: () => openLightbox(card.fileUrl) } }));
  } else if (card.fileType === "pdf" && card.fileUrl) {
    body.appendChild(
      el("div", { class: "card__file", attrs: { style: "margin-top:12px" } }, [
        el("span", { class: "card__file-icon", text: "📄" }),
        el("span", { class: "card__file-name", text: card.fileName || "PDF 교안" }),
        el("a", { class: "btn btn--ghost btn--sm", attrs: { href: card.fileUrl, target: "_blank", rel: "noopener" }, text: "보기" }),
        el("a", { class: "btn btn--ghost btn--sm", attrs: { href: card.fileUrl, download: card.fileName || "", target: "_blank", rel: "noopener" }, text: "다운로드" }),
      ])
    );
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
  let pastedFile = null;       // 클립보드/파일 입력으로 받은 File
  let removeExistingFile = false;

  const nameInput = el("input", { class: "input", attrs: { placeholder: "이름", value: isEdit ? existing.authorName : lastName } });
  const titleInput = el("input", { class: "input", attrs: { placeholder: "제목", value: isEdit ? existing.title || "" : "" } });
  const bodyInput = el("textarea", { class: "textarea", attrs: { placeholder: "내용 또는 프롬프트를 입력하세요" } });
  bodyInput.value = isEdit ? existing.body || "" : "";
  const promptCheck = el("input", { attrs: { type: "checkbox", id: "is-prompt" } });
  if (isEdit && existing.isPrompt) promptCheck.checked = true;
  const linkInput = el("input", { class: "input", attrs: { placeholder: "https:// 참고 사이트 · 실습 사이트 주소 (선택)", value: isEdit ? existing.linkUrl || "" : "" } });

  // 파일: 클립보드 붙여넣기 + 파일 선택
  const fileInput = el("input", { attrs: { type: "file", accept: "image/*,application/pdf", style: "display:none" } });
  const chosen = el("div", { class: "file-chosen" });
  const pasteZone = el("div", {
    class: "paste-zone",
    text: "파일을 여기로 끌어다 놓거나, 이미지를 붙여넣기(Ctrl+V) 하거나, 클릭해 선택하세요 (PDF·이미지)",
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
        const file = e.dataTransfer?.files?.[0];
        if (file) setFile(file);
      },
    },
  });

  // 모달이 열려 있는 동안 어디서든 Ctrl+V 로 이미지 붙여넣기 허용
  const onPaste = (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item) {
      setFile(item.getAsFile());
      pasteZone.classList.add("paste-zone--active");
      e.preventDefault();
    }
  };
  document.addEventListener("paste", onPaste);

  function setFile(file) {
    if (file) {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const isImage = file.type.startsWith("image/");
      // 드래그&드롭은 형식 제한을 우회하므로 여기서 직접 검증
      if (!isPdf && !isImage) {
        showToast("이미지 또는 PDF만 첨부할 수 있어요");
        return;
      }
      // PDF 는 압축 없이 그대로 올라가므로 20MB 제한을 미리 안내. (이미지는 업로드 전 자동 압축)
      if (isPdf && file.size > 20 * 1024 * 1024) {
        showToast("PDF는 20MB까지 첨부할 수 있어요");
        return;
      }
    }
    pastedFile = file;
    removeExistingFile = false;
    chosen.innerHTML = "";
    if (!file) return;
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      const wrap = el("div", { class: "paste-preview" }, [
        el("img", { attrs: { src: url } }),
        el("button", { class: "remove-file", text: "✕", attrs: { type: "button" }, on: { click: () => { pastedFile = null; chosen.innerHTML = ""; } } }),
      ]);
      chosen.appendChild(wrap);
    } else {
      chosen.appendChild(el("span", { text: `📄 ${file.name}` }));
      chosen.appendChild(el("button", { class: "btn btn--ghost btn--sm", text: "제거", attrs: { type: "button" }, on: { click: () => { pastedFile = null; chosen.innerHTML = ""; } } }));
    }
  }
  fileInput.addEventListener("change", () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });

  // 기존 첨부 표시 (수정 모드)
  if (isEdit && existing.fileUrl) {
    const existingInfo = el("div", { class: "file-chosen" }, [
      el("span", { text: existing.fileType === "pdf" ? `📄 ${existing.fileName || "PDF"}` : "🖼 기존 이미지" }),
      el("button", { class: "btn btn--ghost btn--sm", text: "첨부 제거", attrs: { type: "button" }, on: { click: (e) => { removeExistingFile = true; e.target.closest(".file-chosen").remove(); } } }),
    ]);
    chosen.appendChild(existingInfo);
  }

  const body = el("div", { class: "modal__body" }, [
    el("div", { class: "field" }, [el("label", { text: "이름" }), nameInput]),
    el("div", { class: "field" }, [el("label", { text: "제목" }), titleInput]),
    el("div", { class: "field" }, [el("label", { text: "내용" }), bodyInput]),
    el("div", { class: "field" }, [
      el("div", { class: "checkbox-row" }, [promptCheck, el("label", { attrs: { for: "is-prompt" }, text: "프롬프트로 표시 (복사 버튼 추가)" })]),
    ]),
    el("div", { class: "field" }, [el("label", { text: "링크" }), linkInput, el("p", { class: "hint", text: "주소를 넣으면 미리보기 카드가 자동 생성됩니다 (실패 시 단순 링크)." })]),
    el("div", { class: "field" }, [el("label", { text: "파일 첨부 (PDF 교안 · 스크린샷, 최대 20MB)" }), pasteZone, fileInput, chosen]),
  ]);

  const saveBtn = el("button", { class: "btn btn--primary", text: isEdit ? "수정" : "등록" });
  const footer = el("div", { class: "modal__footer" }, [
    el("button", { class: "btn btn--ghost", text: "취소", on: { click: closeModal } }),
    saveBtn,
  ]);

  saveBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim() || "익명";
    const hasContent = titleInput.value.trim() || bodyInput.value.trim() || linkInput.value.trim() || pastedFile || (isEdit && existing.fileUrl && !removeExistingFile);
    if (!hasContent) {
      showToast("제목·내용·링크·파일 중 하나는 입력해주세요");
      return;
    }
    rememberName(name);
    saveBtn.disabled = true;
    saveBtn.textContent = "저장 중…";
    try {
      // 링크 미리보기 (링크가 바뀌었거나, 기존 미리보기에 썸네일이 없으면 다시 생성)
      let linkPreview = isEdit ? existing.linkPreview : null;
      const linkVal = linkInput.value.trim();
      const prevLink = isEdit ? existing.linkUrl || "" : "";
      if (linkVal && (linkVal !== prevLink || !linkPreview || !linkPreview.image)) {
        linkPreview = await fetchLinkPreview(linkVal);
      } else if (!linkVal) {
        linkPreview = null;
      }

      const payload = {
        title: titleInput.value,
        body: bodyInput.value,
        isPrompt: promptCheck.checked,
        linkUrl: linkVal,
        linkPreview,
        authorName: name,
        file: pastedFile || undefined,
      };

      if (isEdit) {
        payload.removeFile = removeExistingFile;
        await updateCard(column.id, existing.id, payload);
        showToast("수정했습니다");
      } else {
        await addCard(column.id, payload);
        showToast("등록했습니다");
      }
      closeModal();
    } catch (e) {
      showToast("저장 실패: " + e.message);
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? "수정" : "등록";
    }
  });

  const overlay = openModal([modalHeader(isEdit ? "글 수정" : "글쓰기"), body, footer]);
  overlay._cleanup = () => document.removeEventListener("paste", onPaste);
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
  const tabSelect = tabsCache.length
    ? el("select", { class: "select" }, tabsCache.map((t) => el("option", { attrs: { value: t.id }, text: t.title })))
    : null;
  if (tabSelect) tabSelect.value = activeTabId || tabsCache[0].id;

  const body = el("div", { class: "modal__body" }, [
    el("div", { class: "field" }, [el("label", { text: "게시판 이름" }), titleInput]),
    tabSelect ? el("div", { class: "field" }, [el("label", { text: "소속 탭" }), tabSelect]) : null,
    el("div", { class: "field" }, [el("label", { text: "글쓰기 권한" }), permSelect]),
    el("div", { class: "field" }, [el("label", { text: "보기 방식" }), layoutSelect]),
  ]);
  const saveBtn = el("button", { class: "btn btn--primary", text: "추가" });
  saveBtn.addEventListener("click", async () => {
    const title = titleInput.value.trim();
    if (!title) return showToast("게시판 이름을 입력하세요");
    try {
      await addColumn(title, permSelect.value, layoutSelect.value, tabSelect ? tabSelect.value : null);
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

  const curTab = column.tabId || (tabsCache[0] ? tabsCache[0].id : null);
  const tabSelect = tabsCache.length
    ? el("select", { class: "select" }, tabsCache.map((t) => el("option", { attrs: { value: t.id }, text: t.title })))
    : null;
  if (tabSelect) tabSelect.value = curTab;

  const body = el("div", { class: "modal__body" }, [
    el("div", { class: "field" }, [el("label", { text: "게시판 이름" }), titleInput]),
    tabSelect ? el("div", { class: "field" }, [el("label", { text: "소속 탭" }), tabSelect]) : null,
    el("div", { class: "field" }, [el("label", { text: "글쓰기 권한" }), permSelect]),
    el("div", { class: "field" }, [el("label", { text: "보기 방식" }), layoutSelect]),
  ]);
  const saveBtn = el("button", { class: "btn btn--primary", text: "저장" });
  saveBtn.addEventListener("click", async () => {
    const title = titleInput.value.trim();
    if (!title) return showToast("이름을 입력하세요");
    try {
      if (title !== column.title) await renameColumn(column.id, title);
      if (permSelect.value !== (column.writePermission || "all")) await setColumnPermission(column.id, permSelect.value);
      if (layoutSelect.value !== (column.layout || "list")) await setColumnLayout(column.id, layoutSelect.value);
      if (tabSelect && tabSelect.value !== curTab) await setColumnTab(column.id, tabSelect.value);
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
  const saveBtn = el("button", { class: "btn btn--primary", text: "추가" });
  saveBtn.addEventListener("click", async () => {
    const title = titleInput.value.trim();
    if (!title) return showToast("탭 이름을 입력하세요");
    try {
      const ref = await addTab(title);
      activeTabId = ref.id; // 새 탭으로 전환
      showToast("탭을 추가했습니다");
      closeModal();
    } catch (e) {
      showToast("추가 실패: " + e.message);
    }
  });
  openModal([
    modalHeader("탭 추가"),
    el("div", { class: "modal__body" }, [
      el("div", { class: "field" }, [
        el("label", { text: "탭 이름" }),
        titleInput,
        el("p", { class: "hint", text: "탭 안에 여러 게시판(칼럼)을 둘 수 있어요. 강의용/실습용 등으로 나눠보세요." }),
      ]),
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
  if (!confirm(`탭 '${tab.title}'을(를) 삭제할까요? 탭 안의 게시판은 삭제되지 않고 첫 번째 탭으로 이동합니다.`)) return;
  deleteTab(tab.id)
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

  // 최초 1회: 비밀번호 없이 입장 → 곧바로 비밀번호 설정 요구
  if (!hasPassword) {
    setTeacher(true);
    showToast("강사 모드로 입장했습니다. 비밀번호를 설정해주세요.");
    openSetPasswordModal({ firstTime: true });
    return;
  }

  // 이후: 비밀번호 입력
  const pwInput = el("input", { class: "input", attrs: { type: "password", placeholder: "강사 비밀번호" } });
  const okBtn = el("button", { class: "btn btn--primary", text: "확인" });
  const tryLogin = async () => {
    okBtn.disabled = true;
    try {
      if (await verifyTeacherPassword(pwInput.value)) {
        setTeacher(true);
        showToast("강사 모드로 전환했습니다");
        closeModal();
      } else {
        showToast("비밀번호가 올바르지 않습니다");
        pwInput.value = "";
        pwInput.focus();
      }
    } catch (e) {
      showToast("확인 실패: " + e.message);
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
    if (a.length < 4) return showToast("비밀번호는 4자 이상으로 정해주세요");
    if (a !== b) return showToast("두 비밀번호가 일치하지 않습니다");
    saveBtn.disabled = true;
    saveBtn.textContent = "저장 중…";
    try {
      await setTeacherPassword(a);
      showToast("비밀번호를 저장했습니다");
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
        ? el("p", { class: "hint", attrs: { style: "margin:0 0 14px" }, text: "이 비밀번호는 다음부터 강사 모드 입장에 사용됩니다. Firestore에 안전하게(해시) 저장돼요." })
        : null,
      el("div", { class: "field" }, [el("label", { text: "새 비밀번호" }), pw1]),
      el("div", { class: "field" }, [el("label", { text: "비밀번호 확인" }), pw2]),
    ]),
    el("div", { class: "modal__footer" }, footer),
  ]);
  pw1.focus();
}

// ---------- 헤더 배선 ----------
export function initHeader() {
  const modeBtn = $("#teacher-mode-btn");
  const addColBtn = $("#add-column-btn");
  const exportBtn = $("#export-btn");
  const changePwBtn = $("#change-pw-btn");
  const badge = $("#teacher-badge");

  changePwBtn.addEventListener("click", () => openSetPasswordModal({ firstTime: false }));

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
      exitTeacherMode();
      showToast("강사 모드를 종료했습니다");
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
    modeBtn.textContent = on ? "강사 모드 종료" : "강사 모드";
    renderAll(); // 권한에 따른 탭/버튼 재노출
  });
}
