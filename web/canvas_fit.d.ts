export interface CanvasFitResult {
  width: number;
  height: number;
  scale: number;
}

export function fitCanvasDisplayToStage(options?: { resetView?: boolean }): CanvasFitResult | null;
export function observeCanvasStageResize(onResize: () => void): () => void;
export function panImageViewBy(deltaX: number, deltaY: number): boolean;
export function zoomImageViewAt(clientX: number, clientY: number, deltaY: number): boolean;
