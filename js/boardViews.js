// 그룹형이 아닌 보드 화면: 격자 · 타일 · 스트림 · 출석부 · 지도
// 각 화면은 { update(ctx), destroy(), startWrite() } 를 돌려준다.
// ctx = { board, column(보관용 칼럼), canWrite, admin }
// 카드 모양·상세·댓글·글쓰기 폼은 그룹형과 같은 ui.js 함수를 그대로 쓴다.
import { el, buildCard, openCardForm, openCardDetail, showToast, attachColumnDnD, fmtTime } from "./ui.js";
import { subscribeCards, updateCardFields } from "./cards.js";
import { isTeacher, canManage } from "./auth.js";

export function mountTypedBoard(container, ctx) {
  const make = VIEWS[ctx.board.type] || VIEWS.grid;
  return make(container, ctx);
}

// 관리자에게만 숨김 글을 보여준다
function visible(cards) {
  return isTeacher() ? cards : cards.filter((c) => !c.hidden);
}

function introEl() {
  return el("p", { class: "tb-intro", attrs: { hidden: true } });
}
function setIntro(node, board) {
  node.textContent = board.description || "";
  node.hidden = !board.description;
}

function emptyEl(ctx, text) {
  const msg = text || (ctx.canWrite ? "아직 글이 없어요. 오른쪽 위 ‘＋ 글쓰기’로 첫 글을 올려 보세요." : "아직 글이 없어요.");
  return el("div", { class: "tb-empty", text: msg });
}

// 이름별로 늘 같은 색 (출석부 아바타 · 지도 핀)
const PALETTE = ["#5b9be0", "#e8697f", "#4cb87e", "#eaa23a", "#9a72d6", "#3fb0b8", "#d9774a", "#6c7fd8"];
function colorOf(name = "") {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function initialOf(name = "") {
  return [...(name.trim() || "?")][0];
}
// 출석부 칸 구분 키: '12번 …' 이면 번호, 아니면 이름 그대로
function slotKey(label = "") {
  const m = label.match(/^\s*(\d+)번/);
  return m ? `#${m[1]}` : label.trim();
}
// 출석부 아바타: 번호 칸이면 번호, 아니면 이름 첫 글자
function badgeOf(label = "") {
  const m = label.match(/^\s*(\d+)번/);
  return m ? m[1] : initialOf(label);
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- 격자 · 타일 · 스트림 ----------
function cardListView(kind) {
  return (container, ctx) => {
    let state = ctx;
    let cards = [];
    const intro = introEl();
    const list = el("div", { class: `tb-list tb-list--${kind}` });
    container.append(intro, list);
    // 스트림(세로 한 줄)은 기존 칼럼처럼 드래그로 순서를 바꿀 수 있다
    if (kind === "stream") attachColumnDnD(list, ctx.column);

    const draw = () => {
      setIntro(intro, state.board);
      list.innerHTML = "";
      if (!cards.length) return list.appendChild(emptyEl(state));
      cards.forEach((c, i) => list.appendChild(buildCard(state.column, c, cards, i)));
    };
    const unsub = subscribeCards(ctx.column.id, (all) => { cards = visible(all); draw(); });

    return {
      update(next) { state = next; draw(); },
      destroy() { unsub(); },
      startWrite() { openCardForm(state.column); },
    };
  };
}

// ---------- 출석부 ----------
// 띵커벨 출석부형처럼 참여자마다 '지정된 칸'이 있고, 칸 머리에 이름 · 아래에 그 사람의 글이 쌓인다
function rollView(container, ctx) {
  let state = ctx;
  let cards = [];
  const intro = introEl();
  const rows = el("div", { class: "roll" });
  container.append(intro, rows);

  const row = (name, list, { orphan = false } = {}) => {
    // 이름 칸 기본값: '3번 김민지' → '김민지', 번호만 있는 칸은 평소 이름 그대로
    const personName = name.replace(/^\s*\d+번\s*/, "");
    const write = () => openCardForm(state.column, null, { extra: { rosterName: name }, presetName: personName || undefined });
    const canAdd = state.canWrite && !orphan;
    return el("section", { class: "roll-cell" + (orphan ? " roll-cell--orphan" : "") + (list.length ? "" : " is-empty") }, [
      el("header", { class: "roll-cell__head" }, [
        orphan ? null : el("span", { class: "roll-avatar", attrs: { style: `background:${colorOf(slotKey(name))}` }, text: badgeOf(name) }),
        el("span", { class: "roll-cell__name", text: name }),
        el("span", { class: "roll-cell__count", text: list.length ? String(list.length) : "" }),
        canAdd && list.length
          ? el("button", { class: "icon-btn roll-cell__add", text: "＋", attrs: { type: "button", title: `${name} 글쓰기` }, on: { click: write } })
          : null,
      ]),
      el("div", { class: "roll-cell__body" }, [
        ...list.map((c, i) => buildCard(state.column, c, list, i)),
        canAdd && !list.length
          ? el("button", { class: "roll-add", text: "＋ 글쓰기", attrs: { type: "button", title: `${name} 글쓰기` }, on: { click: write } })
          : null,
        !canAdd && !list.length && !orphan ? el("span", { class: "roll-cell__none", text: "아직 글이 없어요" }) : null,
      ]),
    ]);
  };

  const draw = () => {
    setIntro(intro, state.board);
    rows.innerHTML = "";
    const roster = state.board.roster || [];
    if (!roster.length) {
      rows.appendChild(emptyEl(state, state.admin ? "참여자 명단이 비어 있어요. 오른쪽 위 ‘⚙ 보드 설정’에서 명단을 입력하세요." : "아직 참여자 명단이 없습니다."));
    }
    // 칸은 번호로 구분 → '3번'에 나중에 이름을 붙여 '3번 김민지'가 돼도 글이 따라간다
    const byKey = new Map(roster.map((n) => [slotKey(n), []]));
    const orphans = [];
    cards.forEach((c) => {
      const list = byKey.get(slotKey(c.rosterName || ""));
      list ? list.push(c) : orphans.push(c);
    });
    roster.forEach((n) => rows.appendChild(row(n, byKey.get(slotKey(n)))));
    if (orphans.length) rows.appendChild(row("명단에 없는 글", orphans, { orphan: true }));
  };
  const unsub = subscribeCards(ctx.column.id, (all) => { cards = visible(all); draw(); });

  return {
    update(next) { state = next; draw(); },
    destroy() { unsub(); },
    startWrite() {}, // 줄마다 글쓰기 버튼이 있다
  };
}

// ---------- 지도 ----------
const LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
const LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
let leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      document.head.appendChild(el("link", { attrs: { rel: "stylesheet", href: LEAFLET_CSS } }));
      const s = el("script", { attrs: { src: LEAFLET_JS } });
      s.onload = () => resolve(window.L);
      s.onerror = () => { leafletPromise = null; reject(new Error("지도 라이브러리를 불러오지 못했습니다")); };
      document.head.appendChild(s);
    });
  }
  return leafletPromise;
}

const REGIONS = {
  korea: { center: [36.35, 127.8], zoom: 7 },
  world: { center: [25, 10], zoom: 2 },
};
const hasPos = (c) => typeof c.lat === "number" && typeof c.lng === "number";

function mapView(container, ctx) {
  let state = ctx;
  let cards = [];
  let map = null;
  let L = null;
  let layer = null;
  let picking = false;
  let fitted = false;
  let destroyed = false;
  const markers = new Map();

  const mapEl = el("div", { class: "mapb__map" }, [el("div", { class: "mapb__loading", text: "지도를 불러오는 중…" })]);
  const hint = el("div", { class: "mapb__hint", attrs: { hidden: true } }, [
    el("span", { text: "📍 지도에서 글을 남길 위치를 클릭하세요" }),
    el("button", { class: "btn btn--ghost btn--sm", text: "취소", attrs: { type: "button" }, on: { click: () => stopPick() } }),
  ]);
  const sideTitle = el("div", { class: "mapb__side-title" });
  const intro = introEl();
  const sideList = el("div", { class: "mapb__list" });
  const root = el("div", { class: "mapb" }, [
    el("div", { class: "mapb__stage" }, [mapEl, hint]),
    el("aside", { class: "mapb__side" }, [sideTitle, intro, sideList]),
  ]);
  container.appendChild(root);

  // 화면 아래 끝까지 지도를 채운다
  const fit = () => {
    // 좁은 화면은 지도·목록을 위아래로 쌓으므로 높이를 CSS 에 맡긴다
    if (window.innerWidth <= 900) root.style.height = "";
    else root.style.height = `${Math.max(420, window.innerHeight - root.getBoundingClientRect().top - 24)}px`;
    map?.invalidateSize();
  };
  fit();
  window.addEventListener("resize", fit);
  const onKey = (e) => { if (e.key === "Escape" && picking) stopPick(); };
  document.addEventListener("keydown", onKey);

  function startPick() {
    if (!state.canWrite) return;
    picking = true;
    root.classList.add("is-picking");
    hint.hidden = false;
  }
  function stopPick() {
    picking = false;
    root.classList.remove("is-picking");
    hint.hidden = true;
  }

  function drawMarkers() {
    if (!map) return;
    layer.clearLayers();
    markers.clear();
    const placed = cards.filter(hasPos);
    placed.forEach((c) => {
      const icon = L.divIcon({
        className: "mpin-wrap",
        html: `<span class="mpin${c.hidden ? " mpin--hidden" : ""}" style="--c:${colorOf(c.authorName)}"><b>${escapeHtml(initialOf(c.authorName))}</b></span>`,
        iconSize: [34, 42],
        iconAnchor: [17, 41],
      });
      const m = L.marker([c.lat, c.lng], { icon, draggable: canManage(c.authorUid), riseOnHover: true, keyboard: true, title: c.title || c.authorName || "글" });
      const label = c.title || (c.body || "").slice(0, 30) || "글";
      m.bindTooltip(`<b>${escapeHtml(label)}</b><br><span>${escapeHtml(c.authorName || "익명")}</span>`, { direction: "top", offset: [0, -38] });
      m.on("click", () => openCardDetail(state.column, c));
      m.on("dragend", () => {
        const p = m.getLatLng();
        updateCardFields(state.column.id, c.id, { lat: p.lat, lng: p.lng })
          .then(() => showToast("위치를 옮겼습니다"))
          .catch((err) => showToast("이동 실패: " + err.message));
      });
      m.addTo(layer);
      markers.set(c.id, m);
    });
    if (!fitted && placed.length) {
      fitted = true;
      map.fitBounds(L.latLngBounds(placed.map((c) => [c.lat, c.lng])).pad(0.35), { maxZoom: 13 });
    }
  }

  function drawSide() {
    sideTitle.textContent = `글 ${cards.length}`;
    setIntro(intro, state.board);
    sideList.innerHTML = "";
    if (!cards.length) {
      sideList.appendChild(emptyEl(state, state.canWrite ? "‘＋ 글쓰기’를 누른 뒤 지도에서 위치를 골라 첫 글을 남겨 보세요." : "아직 글이 없어요."));
      return;
    }
    cards.forEach((c) => {
      sideList.appendChild(el("div", { class: "mapb__item" + (c.hidden ? " is-hidden" : "") }, [
        el("button", {
          class: "mapb__item-main",
          attrs: { type: "button" },
          on: {
            click: () => {
              if (!hasPos(c) || !map) return openCardDetail(state.column, c);
              map.flyTo([c.lat, c.lng], Math.max(map.getZoom(), 12), { duration: 0.6 });
              markers.get(c.id)?.openTooltip();
            },
          },
        }, [
          el("span", { class: "mapb__dot", attrs: { style: `background:${colorOf(c.authorName)}` }, text: initialOf(c.authorName) }),
          el("span", { class: "mapb__item-text" }, [
            el("b", { text: c.title || (c.body || "").slice(0, 40) || "글" }),
            el("small", { text: `${c.authorName || "익명"} · ${fmtTime(c.createdAt)}${hasPos(c) ? "" : " · 위치 없음"}` }),
          ]),
        ]),
        el("button", { class: "btn btn--ghost btn--sm", text: "보기", attrs: { type: "button" }, on: { click: () => openCardDetail(state.column, c) } }),
      ]));
    });
  }

  const draw = () => { drawSide(); drawMarkers(); };

  loadLeaflet()
    .then((lib) => {
      if (destroyed) return;
      L = lib;
      mapEl.innerHTML = "";
      const region = REGIONS[state.board.region] || REGIONS.korea;
      map = L.map(mapEl, { worldCopyJump: true }).setView(region.center, region.zoom);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
      layer = L.layerGroup().addTo(map);
      map.on("click", (e) => {
        if (!picking) return;
        stopPick();
        openCardForm(state.column, null, { extra: { lat: e.latlng.lat, lng: e.latlng.lng } });
      });
      fit();
      drawMarkers();
    })
    .catch((err) => {
      mapEl.innerHTML = "";
      mapEl.appendChild(el("div", { class: "mapb__loading", text: err.message }));
    });

  const unsub = subscribeCards(ctx.column.id, (all) => { cards = visible(all); draw(); });

  return {
    update(next) { state = next; if (!state.canWrite) stopPick(); draw(); },
    destroy() {
      destroyed = true;
      unsub();
      window.removeEventListener("resize", fit);
      document.removeEventListener("keydown", onKey);
      map?.remove();
    },
    startWrite() {
      if (!map) return showToast("지도를 불러오는 중입니다");
      picking ? stopPick() : startPick();
    },
  };
}

const VIEWS = {
  grid: cardListView("grid"),
  tile: cardListView("tile"),
  stream: cardListView("stream"),
  roll: rollView,
  map: mapView,
};
