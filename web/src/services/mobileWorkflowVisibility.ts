const MOBILE_WORKFLOW_MEDIA_QUERY = "(max-width: 560px) and (pointer: coarse) and (hover: none)";

let rstlLayerVisible = true;
let wrinkleLayerVisible = true;
let incisionCandidateVisible = true;
let visibilityRevision = 0;
const visibilityListeners = new Set<() => void>();

export interface WorkflowLayerVisibilitySnapshot {
  revision: number;
  rstl: boolean;
  wrinkles: boolean;
  incision: boolean;
}

let visibilitySnapshot: WorkflowLayerVisibilitySnapshot = {
  revision: visibilityRevision,
  rstl: rstlLayerVisible,
  wrinkles: wrinkleLayerVisible,
  incision: incisionCandidateVisible,
};

function workflowRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".workflow-workbench");
}

export function mobileWorkflowViewportActive(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia(MOBILE_WORKFLOW_MEDIA_QUERY).matches;
}

export function mobileRstlLayerVisible(): boolean {
  return rstlLayerVisible;
}

export function mobileWrinkleLayerVisible(): boolean {
  return wrinkleLayerVisible;
}

export function mobileIncisionCandidateVisible(): boolean {
  return incisionCandidateVisible;
}

// This module owns display gates only. It must never mutate generated RSTL,
// wrinkle, or incision data; hiding a layer only changes redraw visibility.
export function workflowLayerVisibilitySnapshot(): WorkflowLayerVisibilitySnapshot {
  return visibilitySnapshot;
}

export function subscribeWorkflowLayerVisibility(listener: () => void): () => void {
  visibilityListeners.add(listener);
  return () => visibilityListeners.delete(listener);
}

function publishVisibility(): void {
  visibilityRevision += 1;
  visibilitySnapshot = {
    revision: visibilityRevision,
    rstl: rstlLayerVisible,
    wrinkles: wrinkleLayerVisible,
    incision: incisionCandidateVisible,
  };
  for (const listener of visibilityListeners) listener();
  window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
}

export function setMobileRstlLayerVisible(visible: boolean): void {
  if (rstlLayerVisible === visible) return;
  rstlLayerVisible = visible;
  const root = workflowRoot();
  if (root) root.dataset.mobileRstlLayerVisible = visible ? "true" : "false";
  publishVisibility();
}

export function setMobileWrinkleLayerVisible(visible: boolean): void {
  if (wrinkleLayerVisible === visible) return;
  wrinkleLayerVisible = visible;
  const root = workflowRoot();
  if (root) root.dataset.mobileWrinkleLayerVisible = visible ? "true" : "false";
  publishVisibility();
}

export function setMobileIncisionCandidateVisible(visible: boolean): void {
  if (incisionCandidateVisible === visible) return;
  incisionCandidateVisible = visible;
  const root = workflowRoot();
  if (root) root.dataset.mobileIncisionCandidateVisible = visible ? "true" : "false";
  publishVisibility();
}

export function resetMobileWorkflowVisibility(): void {
  const changed = !rstlLayerVisible || !wrinkleLayerVisible || !incisionCandidateVisible;
  rstlLayerVisible = true;
  wrinkleLayerVisible = true;
  incisionCandidateVisible = true;
  const root = workflowRoot();
  if (root) {
    delete root.dataset.mobileRstlLayerVisible;
    delete root.dataset.mobileWrinkleLayerVisible;
    delete root.dataset.mobileIncisionCandidateVisible;
  }
  if (changed) publishVisibility();
}
