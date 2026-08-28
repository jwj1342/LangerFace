export interface LiveCanvasInteractionCallbacks {
  isRefineActive(): boolean;
  isImagePointerInteractionBlocked?(): boolean;
  isMobileTouchImageGestureEnabled?(): boolean;
  beginRefinePointer(event: PointerEvent): boolean;
  moveRefinePointer(event: PointerEvent): boolean;
  endRefinePointer(event: PointerEvent): boolean;
  sourceKind(): string | null;
  panImageViewBy(deltaX: number, deltaY: number): void;
  zoomImageViewAt(clientX: number, clientY: number, deltaY: number): boolean;
  zoomImageViewByFactorAt?(clientX: number, clientY: number, factor: number): boolean;
  transformImageViewGesture?(
    previousClientX: number,
    previousClientY: number,
    nextClientX: number,
    nextClientY: number,
    factor: number,
  ): boolean;
  adjustFocusZoom(deltaY: number): boolean;
  updateRefineUi(): void;
  refreshStaticImage(): void;
  onImageViewChanged?(): void;
}

export interface LiveCanvasInteractionOptions {
  signal?: AbortSignal;
}

interface ImageDragState {
  pointerId: number;
  x: number;
  y: number;
}

interface TouchPoint {
  x: number;
  y: number;
}

interface PinchState {
  centerX: number;
  centerY: number;
  distance: number;
}

function pinchState(points: Map<number, TouchPoint>): PinchState | null {
  const [first, second] = [...points.values()];
  if (!first || !second) return null;
  return {
    centerX: (first.x + second.x) / 2,
    centerY: (first.y + second.y) / 2,
    distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
  };
}

export function bindLiveCanvasInteractions(
  surface: HTMLElement,
  callbacks: LiveCanvasInteractionCallbacks,
  { signal }: LiveCanvasInteractionOptions = {},
): () => void {
  let imageDrag: ImageDragState | null = null;
  const touchPoints = new Map<number, TouchPoint>();
  let pinch: PinchState | null = null;
  let disposed = false;

  const mobileTouchGestureEnabled = (event: PointerEvent): boolean => (
    event.pointerType === "touch"
    && callbacks.sourceKind() === "image"
    && callbacks.isMobileTouchImageGestureEnabled?.() === true
    && !callbacks.isRefineActive()
  );

  const captureTouchPointers = (): void => {
    for (const pointerId of touchPoints.keys()) {
      if (!surface.hasPointerCapture(pointerId)) surface.setPointerCapture(pointerId);
    }
  };

  const releaseTouchPointer = (pointerId: number): void => {
    if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
  };

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
    if (mobileTouchGestureEnabled(event)) {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPoints.size >= 2) {
        clearImageDrag();
        pinch = pinchState(touchPoints);
        captureTouchPointers();
        event.preventDefault();
        return;
      }
    }
    if (callbacks.isImagePointerInteractionBlocked?.()) {
      clearImageDrag();
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
    if (mobileTouchGestureEnabled(event) && touchPoints.has(event.pointerId)) {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPoints.size >= 2) {
        const nextPinch = pinchState(touchPoints);
        if (pinch && nextPinch) {
          const ratio = nextPinch.distance / Math.max(1, pinch.distance);
          const deltaX = nextPinch.centerX - pinch.centerX;
          const deltaYCenter = nextPinch.centerY - pinch.centerY;
          const viewChanged = callbacks.transformImageViewGesture
            ? callbacks.transformImageViewGesture(
              pinch.centerX,
              pinch.centerY,
              nextPinch.centerX,
              nextPinch.centerY,
              ratio,
            )
            : (() => {
              if (deltaX || deltaYCenter) callbacks.panImageViewBy(deltaX, deltaYCenter);
              const zoomChanged = callbacks.zoomImageViewByFactorAt
                ? callbacks.zoomImageViewByFactorAt(nextPinch.centerX, nextPinch.centerY, ratio)
                : callbacks.zoomImageViewAt(
                  nextPinch.centerX,
                  nextPinch.centerY,
                  -Math.log(Math.max(0.01, ratio)) / 0.0018,
                );
              return Boolean(zoomChanged || deltaX || deltaYCenter);
            })();
          if (viewChanged) callbacks.onImageViewChanged?.();
        }
        pinch = nextPinch;
        event.preventDefault();
        return;
      }
    }
    if (callbacks.isImagePointerInteractionBlocked?.()) {
      clearImageDrag();
      return;
    }
    if (!imageDrag || event.pointerId !== imageDrag.pointerId) return;
    callbacks.panImageViewBy(event.clientX - imageDrag.x, event.clientY - imageDrag.y);
    imageDrag.x = event.clientX;
    imageDrag.y = event.clientY;
    event.preventDefault();
  };

  const pointerEnd = (event: PointerEvent): void => {
    touchPoints.delete(event.pointerId);
    if (touchPoints.size < 2) pinch = null;
    releaseTouchPointer(event.pointerId);
    const refineHandled = callbacks.isRefineActive() && callbacks.endRefinePointer(event);
    clearImageDrag(event.pointerId);
    if (refineHandled) event.preventDefault();
  };

  const pointerCaptureLost = (event: PointerEvent): void => {
    touchPoints.delete(event.pointerId);
    if (touchPoints.size < 2) pinch = null;
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
    for (const pointerId of touchPoints.keys()) releaseTouchPointer(pointerId);
    touchPoints.clear();
    pinch = null;
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
