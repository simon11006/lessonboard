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
    const api = `https://api.microlink.io/?url=${encodeURIComponent(normalized)}`;
    const res = await fetch(api);
    if (!res.ok) throw new Error(`microlink ${res.status}`);
    const json = await res.json();
    if (json.status !== "success") throw new Error("microlink not success");

    const d = json.data || {};
    const preview = {
      title: d.title || normalized,
      description: d.description || "",
      image: d.image?.url || d.logo?.url || "",
    };
    cache.set(normalized, preview);
    return preview;
  } catch (err) {
    console.warn("링크 미리보기 실패, 단순 링크로 표시합니다:", err.message);
    cache.set(normalized, null);
    return null;
  }
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
