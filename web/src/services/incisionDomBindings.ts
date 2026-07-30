import type { IncisionDomElements } from "./incisionDom";

export type IncisionDomCleanup = () => void;

interface PointerDragState {
  x: number;
  y: number;
  moved: number;
  id: number;
  handle?: number | null;
}

export interface IncisionDomEventHandlers {
  endpointHandleFromEvent(event: PointerEvent): number | null;
  dragEndpoint(event: PointerEvent, handle: number): void;
  rotateHead(dx: number, dy: number): void;
  pickFace(event: PointerEvent): void;
  commitEndpointDrag(): void;
  zoomHead(direction: number): void;
  publishState(reason: string): void;
  onTumorKindChange(): void;
  onDiameterInput(): void;
  onDiameterChange(): void;
  onDepthInput(): void;
  onDepthChange(): void;
  onMarginInput(): void;
  onMarginChange(): void;
  onEllipseRatioInput(): void;
  onEllipseRatioChange(): void;
  onBoundaryModeChange(): void;
  onRunWorkflow(): void;
  onToggleBoundary(): void;
  onClearBoundary(): void;
  onExportTumor(): void;
  onImportTumorRequest(): void;
  onImportSecondaryCueRequest(): void;
  onClearSecondaryCue(): void;
  onSecondaryCueConfirmed(): void;
  onEditInput(): void;
  onEditCommit(): void;
  onEditReasonChange(): void;
  onUndoEdit(): void;
  onRedoEdit(): void;
  onResetEdit(): void;
  onReviewDecisionChange(): void;
  onApproveCandidate(): void;
  onRejectCandidate(): void;
  onSaveReview(): void;
  onSaveCandidate(): void;
  onMakeVariants(): void;
  onClearSaved(): void;
  onExportReview(): void;
  onExportReport(): void;
  onExportScreenshot(): void;
  onStageLiveOverlay(): void;
  onTumorFile(file?: File): void;
  onSecondaryCueFile(file?: File): void;
  onResize(): void;
}

function fileFromEvent(event: Event): File | undefined {
  return (event.target as HTMLInputElement | null)?.files?.[0] ?? undefined;
}

export function bindIncisionDomEvents({
  elements,
  reactManaged,
  handlers,
}: {
  elements: IncisionDomElements;
  reactManaged: boolean;
  handlers: IncisionDomEventHandlers;
}): IncisionDomCleanup {
  const cleanups: IncisionDomCleanup[] = [];
  const listen = (
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions,
  ) => {
    target.addEventListener(type, listener, options);
    cleanups.push(() => target.removeEventListener(type, listener, options));
  };
  const action = (target: EventTarget, type: string, callback: () => void) => {
    listen(target, type, () => callback());
  };

  let drag: PointerDragState | null = null;
  listen(elements.canvas, "pointerdown", ((event: PointerEvent) => {
    const handle = handlers.endpointHandleFromEvent(event);
    drag = {
      x: event.clientX,
      y: event.clientY,
      moved: 0,
      id: event.pointerId,
      handle,
    };
    elements.canvas.setPointerCapture(event.pointerId);
  }) as EventListener);
  listen(elements.canvas, "pointermove", ((event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (drag.handle != null) {
      handlers.dragEndpoint(event, drag.handle);
      drag.moved += Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y);
      drag.x = event.clientX;
      drag.y = event.clientY;
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    handlers.rotateHead(dx, dy);
    drag.x = event.clientX;
    drag.y = event.clientY;
  }) as EventListener);
  listen(elements.canvas, "pointerup", ((event: PointerEvent) => {
    const endpointDrag = drag?.handle != null;
    const moved = drag?.moved || 0;
    if (drag && moved < 6 && !endpointDrag) handlers.pickFace(event);
    if (endpointDrag && moved >= 1) handlers.commitEndpointDrag();
    drag = null;
  }) as EventListener);
  listen(elements.canvas, "pointercancel", (() => {
    drag = null;
  }) as EventListener);
  listen(elements.canvas, "wheel", ((event: WheelEvent) => {
    event.preventDefault();
    handlers.zoomHead(event.deltaY);
  }) as EventListener, { passive: false });

  if (!reactManaged) {
    const stateRoot = elements.canvas.closest(".app");
    if (stateRoot) {
      action(stateRoot, "change", () => handlers.publishState("form_change"));
      listen(stateRoot, "input", ((event: Event) => {
        if (
          event.target instanceof HTMLInputElement
          || event.target instanceof HTMLSelectElement
          || event.target instanceof HTMLTextAreaElement
        ) {
          handlers.publishState("form_input");
        }
      }) as EventListener);
    }

    action(elements.tumorKind, "change", handlers.onTumorKindChange);
    action(elements.diameter, "input", handlers.onDiameterInput);
    action(elements.diameter, "change", handlers.onDiameterChange);
    action(elements.depth, "input", handlers.onDepthInput);
    action(elements.depth, "change", handlers.onDepthChange);
    action(elements.margin, "input", handlers.onMarginInput);
    action(elements.margin, "change", handlers.onMarginChange);
    action(elements.ellipseRatio, "input", handlers.onEllipseRatioInput);
    action(elements.ellipseRatio, "change", handlers.onEllipseRatioChange);
    action(elements.boundaryMode, "change", handlers.onBoundaryModeChange);
    action(elements.run, "click", handlers.onRunWorkflow);
    action(elements.startBoundary, "click", handlers.onToggleBoundary);
    action(elements.clearBoundary, "click", handlers.onClearBoundary);
    action(elements.exportTumor, "click", handlers.onExportTumor);
    action(elements.importTumor, "click", handlers.onImportTumorRequest);

    action(elements.importSecondaryCue, "click", handlers.onImportSecondaryCueRequest);
    action(elements.clearSecondaryCue, "click", handlers.onClearSecondaryCue);
    action(elements.secondaryCueConfirmed, "change", handlers.onSecondaryCueConfirmed);

    const editControls = [
      elements.angleOffset,
      elements.lengthScale,
      elements.widthScale,
      elements.tipAngle,
      elements.shiftAlong,
      elements.shiftPerp,
    ];
    for (const element of editControls) {
      action(element, "input", handlers.onEditInput);
      action(element, "change", handlers.onEditCommit);
    }
    action(elements.editReason, "change", handlers.onEditReasonChange);
    action(elements.undoEdit, "click", handlers.onUndoEdit);
    action(elements.redoEdit, "click", handlers.onRedoEdit);
    action(elements.resetEdit, "click", handlers.onResetEdit);

    action(elements.reviewDecision, "change", handlers.onReviewDecisionChange);
    action(elements.approveCandidate, "click", handlers.onApproveCandidate);
    action(elements.rejectCandidate, "click", handlers.onRejectCandidate);
    action(elements.saveReview, "click", handlers.onSaveReview);

    action(elements.saveCandidate, "click", handlers.onSaveCandidate);
    action(elements.makeVariants, "click", handlers.onMakeVariants);
    action(elements.clearSaved, "click", handlers.onClearSaved);
    action(elements.exportJson, "click", handlers.onExportReview);
    action(elements.exportReport, "click", handlers.onExportReport);
    action(elements.exportPng, "click", handlers.onExportScreenshot);
    action(elements.stageLiveOverlay, "click", handlers.onStageLiveOverlay);
  }

  listen(elements.tumorImportFile, "change", ((event: Event) => {
    handlers.onTumorFile(fileFromEvent(event));
  }) as EventListener);
  listen(elements.secondaryCueImportFile, "change", ((event: Event) => {
    handlers.onSecondaryCueFile(fileFromEvent(event));
  }) as EventListener);

  const resizeObserver = new ResizeObserver(() => handlers.onResize());
  resizeObserver.observe(elements.wrap);
  cleanups.push(() => resizeObserver.disconnect());

  return () => {
    drag = null;
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  };
}
