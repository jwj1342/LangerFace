import { fitContainSize, nextImageGestureViewState, type FitContainResult } from "./fitMath";
import { els } from "./liveDom";
import { renderState, sourceState } from "./liveState";

export { fitContainSize };
export type CanvasFitResult = FitContainResult;

interface CanvasFitOptions {
  resetView?: boolean;
}

interface ResetImageViewOptions {
  apply?: boolean;
}

export interface ImageViewResumeState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function fitCanvasDisplayToStage({ resetView = false }: CanvasFitOptions = {}): CanvasFitResult | null {
  const rect = els.mainWrap.getBoundingClientRect();
  const fit = fitContainSize(els.canvas.width, els.canvas.height, rect.width, rect.height);
  if (!fit.width || !fit.height) return null;

  const view = renderState.imageView;
  view.baseWidth = fit.width;
  view.baseHeight = fit.height;
  view.fitScale = fit.scale;
  if (resetView) resetImageView();
  else clampImageViewOffset();
  applyImageViewStyle();
  return fit;
}

export function clearCanvasDisplayFit(): void {
  const view = renderState.imageView;
  view.baseWidth = 0;
  view.baseHeight = 0;
  view.fitScale = 1;
  resetImageView({ apply: false });
  els.canvas.style.width = "";
  els.canvas.style.height = "";
  els.canvas.style.removeProperty("--img-zoom");
  els.canvas.style.removeProperty("--img-pan-x");
  els.canvas.style.removeProperty("--img-pan-y");
  sourceState.planning2d?.setView(null);
}

export function resetImageView({ apply = true }: ResetImageViewOptions = {}): void {
  const view = renderState.imageView;
  view.zoom = 1;
  view.offsetX = 0;
  view.offsetY = 0;
  if (apply) applyImageViewStyle();
}

export function captureImageViewState(): ImageViewResumeState {
  const view = renderState.imageView;
  return {
    zoom: view.zoom,
    offsetX: view.offsetX,
    offsetY: view.offsetY,
  };
}

export function restoreImageViewState(snapshot: ImageViewResumeState): void {
  const view = renderState.imageView;
  view.zoom = clamp(snapshot.zoom, view.minZoom, view.maxZoom);
  view.offsetX = Number.isFinite(snapshot.offsetX) ? snapshot.offsetX : 0;
  view.offsetY = Number.isFinite(snapshot.offsetY) ? snapshot.offsetY : 0;
  clampImageViewOffset();
  applyImageViewStyle();
}

export function setRefineCanvasViewActive(active: boolean): void {
  els.canvas.classList.toggle("refine-image-source", active);
  if (active) {
    fitCanvasDisplayToStage({ resetView: !renderState.imageView.baseWidth });
    return;
  }
  if (!els.canvas.classList.contains("image-source")) clearCanvasDisplayFit();
}

export function stepImageViewZoom(direction: -1 | 1): boolean {
  const wrap = els.mainWrap.getBoundingClientRect();
  return zoomImageViewAt(
    wrap.left + wrap.width / 2,
    wrap.top + wrap.height / 2,
    direction > 0 ? -120 : 120,
  );
}

export function zoomImageViewAt(clientX: number, clientY: number, deltaY: number): boolean {
  const factor = Math.exp(-clamp(deltaY || 0, -160, 160) * 0.0018);
  return zoomImageViewByFactorAt(clientX, clientY, factor);
}

export function zoomImageViewByFactorAt(clientX: number, clientY: number, factor: number): boolean {
  return transformImageViewGesture(clientX, clientY, clientX, clientY, factor);
}

export function transformImageViewGesture(
  previousClientX: number,
  previousClientY: number,
  nextClientX: number,
  nextClientY: number,
  factor: number,
): boolean {
  const view = renderState.imageView;
  if (!view.baseWidth || !view.baseHeight || !Number.isFinite(factor) || factor <= 0) return false;

  const wrap = els.mainWrap.getBoundingClientRect();
  const viewportCenterX = wrap.left + wrap.width / 2;
  const viewportCenterY = wrap.top + wrap.height / 2;
  const previousPointerX = previousClientX - viewportCenterX;
  const previousPointerY = previousClientY - viewportCenterY;
  const nextPointerX = nextClientX - viewportCenterX;
  const nextPointerY = nextClientY - viewportCenterY;
  const oldZoom = view.zoom;
  const previousOffsetX = view.offsetX;
  const previousOffsetY = view.offsetY;
  const nextView = nextImageGestureViewState(
    view,
    { x: previousPointerX, y: previousPointerY },
    { x: nextPointerX, y: nextPointerY },
    factor,
  );
  if (!nextView) return false;
  view.offsetX = nextView.offsetX;
  view.offsetY = nextView.offsetY;
  view.zoom = nextView.zoom;
  clampImageViewOffset();
  const changed = Math.abs(view.zoom - oldZoom) >= 0.001
    || Math.abs(view.offsetX - previousOffsetX) >= 0.001
    || Math.abs(view.offsetY - previousOffsetY) >= 0.001;
  if (!changed) return false;
  applyImageViewStyle();
  return true;
}

export function panImageViewBy(deltaX: number, deltaY: number): boolean {
  const view = renderState.imageView;
  if (!view.baseWidth || !view.baseHeight) return false;
  view.offsetX += deltaX;
  view.offsetY += deltaY;
  clampImageViewOffset();
  applyImageViewStyle();
  return true;
}

export function applyImageViewStyle(): void {
  const view = renderState.imageView;
  if (!view.baseWidth || !view.baseHeight) return;
  els.canvas.style.width = `${Math.round(view.baseWidth)}px`;
  els.canvas.style.height = `${Math.round(view.baseHeight)}px`;
  els.canvas.style.setProperty("--img-zoom", `${view.zoom}`);
  els.canvas.style.setProperty("--img-pan-x", `${Math.round(view.offsetX)}px`);
  els.canvas.style.setProperty("--img-pan-y", `${Math.round(view.offsetY)}px`);
  const wrap = els.mainWrap.getBoundingClientRect();
  sourceState.planning2d?.setView({
    viewportLeft: wrap.left,
    viewportTop: wrap.top,
    viewportWidth: wrap.width,
    viewportHeight: wrap.height,
    canvasWidth: els.canvas.width,
    canvasHeight: els.canvas.height,
    zoom: view.zoom,
    offsetX: view.offsetX,
    offsetY: view.offsetY,
    mirror: renderState.mirror,
    devicePixelRatio: globalThis.devicePixelRatio || 1,
  });
}

function clampImageViewOffset(): void {
  const view = renderState.imageView;
  const wrap = els.mainWrap.getBoundingClientRect();
  const overflowX = Math.max(0, (view.baseWidth * view.zoom - wrap.width) / 2);
  const overflowY = Math.max(0, (view.baseHeight * view.zoom - wrap.height) / 2);
  view.offsetX = clamp(view.offsetX, -overflowX, overflowX);
  view.offsetY = clamp(view.offsetY, -overflowY, overflowY);
}

export function observeCanvasStageResize(onResize: () => void): () => void {
  let raf = 0;
  const schedule = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = 0;
      onResize();
    });
  };

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(schedule);
    observer.observe(els.mainWrap);
    return () => observer.disconnect();
  }

  window.addEventListener("resize", schedule);
  return () => window.removeEventListener("resize", schedule);
}
