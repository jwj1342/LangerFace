export type AnnotationDragAxis = "yaw" | "pitch" | "free" | null;

export interface AnnotationDragState {
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
  axis: AnnotationDragAxis;
}

export interface AnnotationOrbitDelta {
  dx: number;
  dy: number;
}

export interface AnnotationDragUpdate {
  state: AnnotationDragState;
  orbit: AnnotationOrbitDelta | null;
}

export interface AnnotationViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const CLICK_TOLERANCE_PX = 4;
const AXIS_LOCK_DISTANCE_PX = 10;
const AXIS_DOMINANCE_RATIO = 1.25;

export function beginAnnotationDrag(x: number, y: number): AnnotationDragState {
  return { x, y, startX: x, startY: y, moved: false, axis: null };
}

export function updateAnnotationDrag(
  state: AnnotationDragState,
  x: number,
  y: number,
): AnnotationDragUpdate {
  const totalDx = x - state.startX;
  const totalDy = y - state.startY;
  const totalDistance = Math.hypot(totalDx, totalDy);
  const moved = state.moved || totalDistance > CLICK_TOLERANCE_PX;
  let axis = state.axis;
  if (!axis && moved && totalDistance > AXIS_LOCK_DISTANCE_PX) {
    axis = Math.abs(totalDx) >= Math.abs(totalDy) * AXIS_DOMINANCE_RATIO
      ? "yaw"
      : Math.abs(totalDy) >= Math.abs(totalDx) * AXIS_DOMINANCE_RATIO
        ? "pitch"
        : "free";
  }
  if (!moved) return { state: { ...state, moved, axis }, orbit: null };

  let dx = x - state.x;
  let dy = y - state.y;
  if (axis === "yaw") dy = 0;
  if (axis === "pitch") dx = 0;
  return {
    state: { ...state, x, y, moved, axis },
    orbit: { dx, dy },
  };
}

export function annotationNdcPoint(
  clientX: number,
  clientY: number,
  rect: AnnotationViewportRect,
): { x: number; y: number } {
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -(((clientY - rect.top) / rect.height) * 2 - 1),
  };
}

export function annotationZoomFactor(deltaY: number): number {
  const delta = Math.max(-180, Math.min(180, deltaY || 0));
  return Math.exp(delta * 0.00055);
}
