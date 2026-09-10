const MOBILE_WORKFLOW_MEDIA_QUERY = "(max-width: 560px) and (pointer: coarse) and (hover: none)";

let rstlLayerVisible = true;
let wrinkleLayerVisible = true;
let incisionCandidateVisible = true;

function workflowRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".workflow-workbench");
}

export function mobileWorkflowViewportActive(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia(MOBILE_WORKFLOW_MEDIA_QUERY).matches;
}

export function mobileRstlLayerVisible(): boolean {
  return !mobileWorkflowViewportActive() || rstlLayerVisible;
}

export function mobileWrinkleLayerVisible(): boolean {
  return !mobileWorkflowViewportActive() || wrinkleLayerVisible;
}

export function mobileIncisionCandidateVisible(): boolean {
  return !mobileWorkflowViewportActive() || incisionCandidateVisible;
}

export function setMobileRstlLayerVisible(visible: boolean): void {
  rstlLayerVisible = visible;
  const root = workflowRoot();
  if (root) root.dataset.mobileRstlLayerVisible = visible ? "true" : "false";
  window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
}

export function setMobileWrinkleLayerVisible(visible: boolean): void {
  wrinkleLayerVisible = visible;
  const root = workflowRoot();
  if (root) root.dataset.mobileWrinkleLayerVisible = visible ? "true" : "false";
  window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
}

export function setMobileIncisionCandidateVisible(visible: boolean): void {
  incisionCandidateVisible = visible;
  const root = workflowRoot();
  if (root) root.dataset.mobileIncisionCandidateVisible = visible ? "true" : "false";
  window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
}

export function resetMobileWorkflowVisibility(): void {
  rstlLayerVisible = true;
  wrinkleLayerVisible = true;
  incisionCandidateVisible = true;
  const root = workflowRoot();
  if (root) {
    delete root.dataset.mobileRstlLayerVisible;
    delete root.dataset.mobileWrinkleLayerVisible;
    delete root.dataset.mobileIncisionCandidateVisible;
  }
  window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
}
