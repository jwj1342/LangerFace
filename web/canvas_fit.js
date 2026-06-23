import { els } from "./dom.js";
import { fitContainSize } from "./fit_math.js";
import { renderState } from "./state.js";

export { fitContainSize };

export function fitCanvasDisplayToStage({ resetView = false } = {}) {
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

export function clearCanvasDisplayFit() {
  const view = renderState.imageView;
  view.baseWidth = 0;
  view.baseHeight = 0;
  view.fitScale = 1;
  resetImageView({ apply: false });
  els.canvas.style.width = "";
  els.canvas.style.height = "";
  els.canvas.style.marginLeft = "";
  els.canvas.style.marginTop = "";
}

export function resetImageView({ apply = true } = {}) {
  const view = renderState.imageView;
  view.zoom = 1;
  view.offsetX = 0;
  view.offsetY = 0;
  if (apply) applyImageViewStyle();
}

export function zoomImageViewAt(clientX, clientY, deltaY) {
  const view = renderState.imageView;
  if (!view.baseWidth || !view.baseHeight) return false;

  const wrap = els.mainWrap.getBoundingClientRect();
  const pointerX = clientX - (wrap.left + wrap.width / 2);
  const pointerY = clientY - (wrap.top + wrap.height / 2);
  const oldZoom = view.zoom;
  const factor = Math.exp(-Math.max(-160, Math.min(160, deltaY || 0)) * 0.0018);
  const nextZoom = Math.max(view.minZoom, Math.min(view.maxZoom, oldZoom * factor));
  if (Math.abs(nextZoom - oldZoom) < 0.001) return false;

  view.offsetX = pointerX - ((pointerX - view.offsetX) / oldZoom) * nextZoom;
  view.offsetY = pointerY - ((pointerY - view.offsetY) / oldZoom) * nextZoom;
  view.zoom = nextZoom;
  clampImageViewOffset();
  applyImageViewStyle();
  return true;
}

export function panImageViewBy(deltaX, deltaY) {
  const view = renderState.imageView;
  if (!view.baseWidth || !view.baseHeight) return false;
  view.offsetX += deltaX;
  view.offsetY += deltaY;
  clampImageViewOffset();
  applyImageViewStyle();
  return true;
}

export function applyImageViewStyle() {
  const view = renderState.imageView;
  if (!view.baseWidth || !view.baseHeight) return;
  els.canvas.style.width = `${Math.round(view.baseWidth * view.zoom)}px`;
  els.canvas.style.height = `${Math.round(view.baseHeight * view.zoom)}px`;
  els.canvas.style.marginLeft = `${Math.round(view.offsetX)}px`;
  els.canvas.style.marginTop = `${Math.round(view.offsetY)}px`;
}

function clampImageViewOffset() {
  const view = renderState.imageView;
  const wrap = els.mainWrap.getBoundingClientRect();
  const overflowX = Math.max(0, (view.baseWidth * view.zoom - wrap.width) / 2);
  const overflowY = Math.max(0, (view.baseHeight * view.zoom - wrap.height) / 2);
  view.offsetX = Math.max(-overflowX, Math.min(overflowX, view.offsetX));
  view.offsetY = Math.max(-overflowY, Math.min(overflowY, view.offsetY));
}

export function observeCanvasStageResize(onResize) {
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
