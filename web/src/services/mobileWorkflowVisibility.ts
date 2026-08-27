let incisionCandidateVisible = true;

function workflowRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".workflow-workbench");
}

export function mobileIncisionCandidateVisible(): boolean {
  return incisionCandidateVisible;
}

export function setMobileIncisionCandidateVisible(visible: boolean): void {
  incisionCandidateVisible = visible;
  const root = workflowRoot();
  if (root) root.dataset.mobileIncisionCandidateVisible = visible ? "true" : "false";
  window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
}

export function resetMobileWorkflowVisibility(): void {
  incisionCandidateVisible = true;
  const root = workflowRoot();
  if (root) delete root.dataset.mobileIncisionCandidateVisible;
  window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));
}
