export interface IncisionBoundaryState {
  boundaryPoints: unknown[];
  boundaryRefs: unknown[];
  boundaryActive: boolean;
}

export function resetIncisionBoundaryState(state: IncisionBoundaryState): void {
  state.boundaryPoints = [];
  state.boundaryRefs = [];
  state.boundaryActive = false;
}
