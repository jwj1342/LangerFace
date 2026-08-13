export interface LiveCanvasInteractionCallbacks {
  isRefineActive(): boolean;
  beginRefinePointer(event: PointerEvent): boolean;
  moveRefinePointer(event: PointerEvent): boolean;
  endRefinePointer(event: PointerEvent): boolean;
  sourceKind(): string | null;
  panImageViewBy(deltaX: number, deltaY: number): void;
  zoomImageViewAt(clientX: number, clientY: number, deltaY: number): boolean;
  adjustFocusZoom(deltaY: number): boolean;
  updateRefineUi(): void;
  refreshStaticImage(): void;
}

export interface LiveCanvasInteractionOptions {
  signal?: AbortSignal;
}

interface ImageDragState {
  pointerId: number;
  x: number;
  y: number;
}

export function bindLiveCanvasInteractions(
  surface: HTMLElement,
  callbacks: LiveCanvasInteractionCallbacks,
  { signal }: LiveCanvasInteractionOptions = {},
): () => void {
  let imageDrag: ImageDragState | null = null;
  let disposed = false;

  const clearImageDrag = (pointerId?: number, releaseCapture = true): boolean => {
    if (!imageDrag || (pointerId != null && imageDrag.pointerId !== pointerId)) return false;
    const activePointerId = imageDrag.pointerId;
    imageDrag = null;
    surface.classList.remove("dragging");
    if (releaseCapture && surface.hasPointerCapture(activePointerId)) {
      surface.releasePointerCapture(activePointerId);
    }
    return true;
  };

  const pointerDown = (event: PointerEvent): void => {
    if (callbacks.isRefineActive()) {
      if (callbacks.beginRefinePointer(event)) event.preventDefault();
      return;
    }
    if (callbacks.sourceKind() !== "image" || event.button !== 0 || imageDrag) return;
    imageDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    surface.classList.add("dragging");
    surface.setPointerCapture(event.pointerId);
  };

  const pointerMove = (event: PointerEvent): void => {
    if (callbacks.isRefineActive()) {
      if (callbacks.moveRefinePointer(event)) event.preventDefault();
      return;
    }
    if (!imageDrag || event.pointerId !== imageDrag.pointerId) return;
    callbacks.panImageViewBy(event.clientX - imageDrag.x, event.clientY - imageDrag.y);
    imageDrag.x = event.clientX;
    imageDrag.y = event.clientY;
    event.preventDefault();
  };

  const pointerEnd = (event: PointerEvent): void => {
    const refineHandled = callbacks.isRefineActive() && callbacks.endRefinePointer(event);
    clearImageDrag(event.pointerId);
    if (refineHandled) event.preventDefault();
  };

  const pointerCaptureLost = (event: PointerEvent): void => {
    const refineHandled = callbacks.isRefineActive() && callbacks.endRefinePointer(event);
    clearImageDrag(event.pointerId, false);
    if (refineHandled) event.preventDefault();
  };

  const wheel = (event: WheelEvent): void => {
    if (callbacks.sourceKind() === "image" || callbacks.isRefineActive()) {
      if (callbacks.zoomImageViewAt(event.clientX, event.clientY, event.deltaY)) {
        if (callbacks.isRefineActive()) callbacks.updateRefineUi();
        event.preventDefault();
      }
      return;
    }
    if (!callbacks.adjustFocusZoom(event.deltaY)) return;
    event.preventDefault();
    callbacks.refreshStaticImage();
  };

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    clearImageDrag();
    surface.removeEventListener("pointerdown", pointerDown);
    surface.removeEventListener("pointermove", pointerMove);
    surface.removeEventListener("pointerup", pointerEnd);
    surface.removeEventListener("pointercancel", pointerEnd);
    surface.removeEventListener("lostpointercapture", pointerCaptureLost);
    surface.removeEventListener("wheel", wheel);
    signal?.removeEventListener("abort", cleanup);
  };

  surface.addEventListener("pointerdown", pointerDown);
  surface.addEventListener("pointermove", pointerMove);
  surface.addEventListener("pointerup", pointerEnd);
  surface.addEventListener("pointercancel", pointerEnd);
  surface.addEventListener("lostpointercapture", pointerCaptureLost);
  surface.addEventListener("wheel", wheel, { passive: false });
  if (signal?.aborted) cleanup();
  else signal?.addEventListener("abort", cleanup, { once: true });
  return cleanup;
}
