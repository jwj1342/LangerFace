import { renderState } from "../../state.js";
import { fitContainSize, type FitContainResult } from "./fitMath";
import { els } from "./liveDom";

export { fitContainSize };
export type CanvasFitResult = FitContainResult;

interface CanvasFitOptions {
  resetView?: boolean;
}

interface ResetImageViewOptions {
  apply?: boolean;
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
}

export function resetImageView({ apply = true }: ResetImageViewOptions = {}): void {
  const view = renderState.imageView;
  view.zoom = 1;
  view.offsetX = 0;
  view.offsetY = 0;
  if (apply) applyImageViewStyle();
}

export function zoomImageViewAt(clientX: number, clientY: number, deltaY: number): boolean {
  const view = renderState.imageView;
  if (!view.baseWidth || !view.baseHeight) return false;

  const wrap = els.mainWrap.getBoundingClientRect();
  const pointerX = clientX - (wrap.left + wrap.width / 2);
  const pointerY = clientY - (wrap.top + wrap.height / 2);
  const oldZoom = view.zoom;
  const factor = Math.exp(-clamp(deltaY || 0, -160, 160) * 0.0018);
  const nextZoom = clamp(oldZoom * factor, view.minZoom, view.maxZoom);
  if (Math.abs(nextZoom - oldZoom) < 0.001) return false;

  view.offsetX = pointerX - ((pointerX - view.offsetX) / oldZoom) * nextZoom;
  view.offsetY = pointerY - ((pointerY - view.offsetY) / oldZoom) * nextZoom;
  view.zoom = nextZoom;
  clampImageViewOffset();
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
