import {
  annotationZoomFactor,
  beginAnnotationDrag,
  updateAnnotationDrag,
  type AnnotationDragState,
} from "./annotationInteraction.ts";

export interface AnnotationPointerPosition {
  clientX: number;
  clientY: number;
}

export interface AnnotationPointerActions {
  orbit(dx: number, dy: number): unknown;
  zoom(factor: number): unknown;
  addPoint(position: AnnotationPointerPosition): unknown;
}

export interface AnnotationPointerOptions {
  signal?: AbortSignal;
}

export function bindAnnotationPointerInteractions(
  surface: HTMLElement,
  actions: AnnotationPointerActions,
  options: AnnotationPointerOptions = {},
): () => void {
  let activePointerId: number | null = null;
  let drag: AnnotationDragState | null = null;
  let disposed = false;

  const releaseCapture = (pointerId: number): void => {
    try {
      if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
    } catch {
      // The browser may have released capture before dispatching cleanup events.
    }
  };

  const clearActivePointer = (release: boolean): void => {
    const pointerId = activePointerId;
    activePointerId = null;
    drag = null;
    if (release && pointerId !== null) releaseCapture(pointerId);
  };

  const pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || activePointerId !== null) return;
    activePointerId = event.pointerId;
    drag = beginAnnotationDrag(event.clientX, event.clientY);
    try {
      surface.setPointerCapture(event.pointerId);
    } catch {
      // Dragging still works while events continue to target the surface.
    }
  };

  const pointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId || !drag) return;
    const update = updateAnnotationDrag(drag, event.clientX, event.clientY);
    drag = update.state;
    if (update.orbit) actions.orbit(update.orbit.dx, update.orbit.dy);
  };

  const pointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId || !drag) return;
    const isClick = !drag.moved;
    clearActivePointer(true);
    if (isClick) actions.addPoint({ clientX: event.clientX, clientY: event.clientY });
  };

  const pointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === activePointerId) clearActivePointer(true);
  };

  const pointerCaptureLost = (event: PointerEvent): void => {
    if (event.pointerId === activePointerId) clearActivePointer(false);
  };

  const wheel = (event: WheelEvent): void => {
    event.preventDefault();
    actions.zoom(annotationZoomFactor(event.deltaY));
  };

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    surface.removeEventListener("pointerdown", pointerDown);
    surface.removeEventListener("pointermove", pointerMove);
    surface.removeEventListener("pointerup", pointerUp);
    surface.removeEventListener("pointercancel", pointerCancel);
    surface.removeEventListener("lostpointercapture", pointerCaptureLost);
    surface.removeEventListener("wheel", wheel);
    options.signal?.removeEventListener("abort", cleanup);
    clearActivePointer(true);
  };

  surface.addEventListener("pointerdown", pointerDown);
  surface.addEventListener("pointermove", pointerMove);
  surface.addEventListener("pointerup", pointerUp);
  surface.addEventListener("pointercancel", pointerCancel);
  surface.addEventListener("lostpointercapture", pointerCaptureLost);
  surface.addEventListener("wheel", wheel, { passive: false });
  if (options.signal?.aborted) cleanup();
  else options.signal?.addEventListener("abort", cleanup, { once: true });
  return cleanup;
}
