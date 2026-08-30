export interface FitContainOptions {
  allowUpscale?: boolean;
}

export interface FitContainResult {
  width: number;
  height: number;
  scale: number;
}

export interface ImageGestureViewState {
  zoom: number;
  minZoom: number;
  maxZoom: number;
  offsetX: number;
  offsetY: number;
}

export interface ImageGesturePoint {
  x: number;
  y: number;
}

export function fitContainSize(
  contentWidth: number,
  contentHeight: number,
  containerWidth: number,
  containerHeight: number,
  { allowUpscale = true }: FitContainOptions = {},
): FitContainResult {
  const srcW = Math.max(1, Number(contentWidth) || 0);
  const srcH = Math.max(1, Number(contentHeight) || 0);
  const boxW = Math.max(0, Number(containerWidth) || 0);
  const boxH = Math.max(0, Number(containerHeight) || 0);
  if (!boxW || !boxH) return { width: 0, height: 0, scale: 0 };

  let scale = Math.min(boxW / srcW, boxH / srcH);
  if (!allowUpscale) scale = Math.min(scale, 1);
  return {
    width: Math.max(1, Math.round(srcW * scale)),
    height: Math.max(1, Math.round(srcH * scale)),
    scale,
  };
}

export function nextImageGestureViewState(
  view: ImageGestureViewState,
  previousPoint: ImageGesturePoint,
  nextPoint: ImageGesturePoint,
  factor: number,
): ImageGestureViewState | null {
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(view.zoom) || view.zoom <= 0) return null;
  const nextZoom = Math.max(view.minZoom, Math.min(view.maxZoom, view.zoom * factor));
  return {
    ...view,
    zoom: nextZoom,
    offsetX: nextPoint.x - ((previousPoint.x - view.offsetX) / view.zoom) * nextZoom,
    offsetY: nextPoint.y - ((previousPoint.y - view.offsetY) / view.zoom) * nextZoom,
  };
}
