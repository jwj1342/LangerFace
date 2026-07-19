// 上传图片进入实时管线前的工作尺寸控制。
export const MAX_IMAGE_SOURCE_DIM = 1600;

export function fitImageToMaxSide(width, height, maxSide = MAX_IMAGE_SOURCE_DIM) {
  const srcW = Math.max(1, Math.round(width || 0));
  const srcH = Math.max(1, Math.round(height || 0));
  const limit = Math.max(1, Math.round(maxSide || MAX_IMAGE_SOURCE_DIM));
  const scale = Math.min(1, limit / Math.max(srcW, srcH));
  return {
    width: Math.max(1, Math.round(srcW * scale)),
    height: Math.max(1, Math.round(srcH * scale)),
    scale,
    scaled: scale < 1,
  };
}

export function prepareImageSource(img, maxSide = MAX_IMAGE_SOURCE_DIM) {
  const fit = fitImageToMaxSide(img.naturalWidth || img.width, img.naturalHeight || img.height, maxSide);
  if (!fit.scaled) return { source: img, ...fit };

  const canvas = document.createElement("canvas");
  canvas.width = fit.width; canvas.height = fit.height;
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, fit.width, fit.height);
  return { source: canvas, ...fit };
}
