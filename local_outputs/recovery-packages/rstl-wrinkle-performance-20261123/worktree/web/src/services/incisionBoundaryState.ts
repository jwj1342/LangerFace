export interface IncisionBoundaryState {
  boundaryPoints: unknown[];
  boundaryRefs: unknown[];
  boundaryActive: boolean;
  controlledBoundaryActive?: boolean;
}

export function resetIncisionBoundaryState(state: IncisionBoundaryState): void {
  state.boundaryPoints = [];
  state.boundaryRefs = [];
  state.boundaryActive = false;
  if ("controlledBoundaryActive" in state) state.controlledBoundaryActive = false;
}
