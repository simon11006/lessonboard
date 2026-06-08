// 업로드 전 이미지 리사이즈/압축 (스크린샷 용량·로딩 최적화)
// PDF·GIF 는 건드리지 않고, 압축 효과가 없으면 원본을 그대로 반환.

/**
 * @param {File} file
 * @param {{maxDim?:number, quality?:number}} opts
 * @returns {Promise<File>} 압축된 파일 또는 원본
 */
export async function compressImage(file, { maxDim = 1600, quality = 0.82 } = {}) {
  if (!file || !file.type.startsWith("image/")) return file;
  if (file.type === "image/gif") return file; // 애니메이션 보존

  try {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    // PNG/WebP 는 형식 유지(투명도 보존), 그 외는 JPEG 로
    const outType = file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
    const blob = await new Promise((res) => canvas.toBlob(res, outType, quality));
    if (!blob || blob.size >= file.size) return file; // 줄지 않으면 원본 유지

    const ext = outType === "image/png" ? "png" : outType === "image/webp" ? "webp" : "jpg";
    const base = (file.name || "image").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.${ext}`, { type: outType });
  } catch (err) {
    console.warn("이미지 압축 실패, 원본 업로드:", err.message);
    return file;
  }
}
