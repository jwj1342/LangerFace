export interface WrinkleWorkingTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface WrinkleWorkingFrameTransform extends WrinkleWorkingTransform {
  size: number;
  targetWidth: number;
  targetHeight: number;
}

type IntrinsicCanvasSource = CanvasImageSource & {
  naturalWidth?: number;
  naturalHeight?: number;
  videoWidth?: number;
  videoHeight?: number;
  displayWidth?: number;
  displayHeight?: number;
  width?: number;
  height?: number;
};

function validDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Returns dimensions owned by the pixel source, never its responsive display size. */
export function wrinkleSourceSize(source: CanvasImageSource): { width: number; height: number } {
  const candidate = source as IntrinsicCanvasSource;
  const pairs: Array<[unknown, unknown]> = [
    [candidate.naturalWidth, candidate.naturalHeight],
    [candidate.videoWidth, candidate.videoHeight],
    [candidate.displayWidth, candidate.displayHeight],
    [candidate.width, candidate.height],
  ];
  const pair = pairs.find(([width, height]) => validDimension(width) && validDimension(height));
  if (!pair) throw new Error("皱纹检测原图尺寸无效");
  return { width: Math.round(pair[0] as number), height: Math.round(pair[1] as number) };
}

export function wrinkleWorkingTransform(
  width: number,
  height: number,
  maximumSize = 1280,
): WrinkleWorkingFrameTransform {
  const maximum = Math.max(width, height);
  if (!(maximum > 0) || !Number.isFinite(maximum)) throw new Error("皱纹检测画面尺寸无效");
  const size = Math.max(4, Math.min(maximumSize, Math.round(maximum)));
  const scale = size / maximum;
  const targetWidth = width * scale;
  const targetHeight = height * scale;
  return {
    size,
    scale,
    targetWidth,
    targetHeight,
    offsetX: (size - targetWidth) / 2,
    offsetY: (size - targetHeight) / 2,
  };
}

export function toWrinkleWorkingPoint(
  point: readonly number[],
  working: WrinkleWorkingTransform,
): [number, number] {
  return [
    point[0] * working.scale + working.offsetX,
    point[1] * working.scale + working.offsetY,
  ];
}

export function fromWrinkleWorkingPoint(
  point: readonly number[],
  working: WrinkleWorkingTransform,
): [number, number] {
  return [
    (point[0] - working.offsetX) / working.scale,
    (point[1] - working.offsetY) / working.scale,
  ];
}
