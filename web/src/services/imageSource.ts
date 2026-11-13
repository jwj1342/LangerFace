export const MAX_IMAGE_SOURCE_DIM = 1600;

export interface ImageFitResult {
  width: number;
  height: number;
  scale: number;
  scaled: boolean;
}

export interface PreparedImageSource extends ImageFitResult {
  source: CanvasImageSource;
}

type ImageLike = CanvasImageSource & {
  naturalWidth?: number;
  naturalHeight?: number;
  width: number;
  height: number;
};

export function fitImageToMaxSide(width: number, height: number, maxSide = MAX_IMAGE_SOURCE_DIM): ImageFitResult {
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

export function prepareImageSource(img: ImageLike, maxSide = MAX_IMAGE_SOURCE_DIM): PreparedImageSource {
  const fit = fitImageToMaxSide(img.naturalWidth || img.width, img.naturalHeight || img.height, maxSide);
  if (!fit.scaled) return { source: img, ...fit };

  const canvas = document.createElement("canvas");
  canvas.width = fit.width;
  canvas.height = fit.height;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2d canvas context is required for image source preparation");
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, fit.width, fit.height);
  return { source: canvas, ...fit };
}
