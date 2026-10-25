// 링크 미리보기 (백엔드 없이 microlink.io 무료 API 호출)
// 실패하거나 한도를 넘으면 null 을 반환 → 호출부에서 단순 링크로 폴백.

const cache = new Map();

/**
 * URL 의 Open Graph 미리보기 정보를 가져온다.
 * @param {string} url
 * @returns {Promise<{title, description, image}|null>}
 */
export async function fetchLinkPreview(url) {
  if (!url) return null;
  const normalized = normalizeUrl(url);
  if (!normalized) return null;
  if (cache.has(normalized)) return cache.get(normalized);

  try {
    // 제목·설명·대표이미지(OG)만 microlink 에서 받는다.
    // (microlink 무료 스크린샷 주소는 시간이 지나면 403 으로 막히므로 저장하지 않는다)
    const api = `https://api.microlink.io/?url=${encodeURIComponent(normalized)}&meta=true`;
    const res = await fetch(api);
    if (!res.ok) throw new Error(`microlink ${res.status}`);
    const json = await res.json();
    if (json.status !== "success") throw new Error("microlink not success");

    const d = json.data || {};
    const preview = {
      title: d.title || normalized,
      description: d.description || "",
      // 대표이미지가 없는 사이트(연수생 제작 웹앱 등)는 만료되지 않는 스크린샷 주소를 쓴다
      image: d.image?.url || screenshotUrl(normalized),
    };
    cache.set(normalized, preview);
    return preview;
  } catch (err) {
    // 제목 정보를 못 받아도 화면 스크린샷 미리보기는 보여준다
    console.warn("링크 정보 가져오기 실패, 스크린샷만 표시합니다:", err.message);
    const preview = { title: normalized, description: "", image: screenshotUrl(normalized) };
    cache.set(normalized, preview);
    return preview;
  }
}

/**
 * 사이트 첫 화면 스크린샷 주소 (WordPress mShots — 무료·키 없음·주소가 만료되지 않음).
 * 처음 요청하면 몇 초간 '생성 중' 그림(400×300)이 오고, 이후 실제 화면이 온다.
 */
export function screenshotUrl(url) {
  const normalized = normalizeUrl(url);
  return normalized ? `https://s0.wp.com/mshots/v1/${encodeURIComponent(normalized)}?w=1280&h=800` : "";
}

/** 저장된 미리보기 이미지가 시간이 지나면 막히는 microlink 스크린샷 주소인지 */
export function isExpiringImage(src) {
  return /^https:\/\/[a-z0-9-]+\.microlink\.io\//i.test(src || "") && !/^https:\/\/api\.microlink\.io\//i.test(src || "");
}

const MSHOTS_PREFIX = "https://s0.wp.com/mshots/";

/**
 * 미리보기 <img> 에 연결: 저장된 주소가 깨지면 링크 주소로 새 스크린샷을 불러온다.
 * mShots 는 처음 찍는 사이트면 오류나 '생성 중' 그림(400×300)을 먼저 주고 뒤에서 스크린샷을 만들므로,
 * 몇 초 간격으로 다시 받아 실제 화면으로 바꾼다. 끝까지 안 되면 깨진 아이콘 대신 그림을 숨긴다.
 */
const MSHOTS_RETRY_MS = [4000, 8000, 15000];
export function attachPreviewFallback(img, linkUrl) {
  const fallback = screenshotUrl(linkUrl);
  let tries = 0;
  const retry = () => {
    if (tries >= MSHOTS_RETRY_MS.length) return false;
    const delay = MSHOTS_RETRY_MS[tries++];
    setTimeout(() => { img.src = `${img.src.split("&r=")[0]}&r=${Date.now()}`; }, delay);
    return true;
  };
  img.addEventListener("error", () => {
    if (fallback && !img.src.startsWith(MSHOTS_PREFIX)) img.src = fallback;
    else if (!retry()) img.style.display = "none";
  });
  img.addEventListener("load", () => {
    const generating = img.src.startsWith(MSHOTS_PREFIX) && img.naturalWidth === 400 && img.naturalHeight === 300;
    if (generating) retry();
  });
  // 이미 만료된 것으로 알려진 주소는 처음부터 새 스크린샷으로
  if (isExpiringImage(img.getAttribute("src")) && fallback) img.src = fallback;
}

export function normalizeUrl(url) {
  if (!url) return "";
  let u = url.trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    return new URL(u).href;
  } catch {
    return "";
  }
}
