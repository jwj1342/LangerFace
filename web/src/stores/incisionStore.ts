import { create } from "zustand";

export interface IncisionTumorState {
  kind: "subcutaneous" | "cutaneous" | string;
  author: string;
  diameterMm: number | null;
  depthMm: number | null;
  marginMm: number | null;
  boundaryMode: string;
  boundaryActive: boolean;
  boundaryPointCount: number;
  boundaryStatus: string;
  boundaryStatusWarn: boolean;
  pickState: string;
  anatomyPreview: string;
  anatomyPreviewWarn: boolean;
}

export interface IncisionProviderState {
  provider: string;
  baseUrl: string;
  model: string;
  timeoutS: number | null;
  stateLabel: string;
  testLabel: string;
}

export interface IncisionSecondaryCueState {
  present: boolean;
  stateLabel: string;
  summary: string;
  manualConfirmed: boolean;
}

export interface IncisionPrivacyAuditState {
  stateLabel: string;
  message: string;
  blocked: boolean;
}

export interface IncisionAssetLoadingState {
  visible: boolean;
  text: string;
}

export interface IncisionReviewState {
  status: string;
  reviewer: string;
  notesPresent: boolean;
}

export interface IncisionEditState {
  angleOffsetDeg: number;
  lengthScalePct: number;
  widthScalePct: number;
  shiftAlongMm: number;
  shiftPerpMm: number;
  reason: string;
  statusLabel: string;
  active: boolean;
  widthScaleVisible: boolean;
  historyLabel: string;
  undoDisabled: boolean;
  redoDisabled: boolean;
}

export interface IncisionCandidateSummary {
  id: string | null;
  type: string | null;
  lengthMm: number | null;
  widthMm: number | null;
  guardrailsPassed: boolean | null;
  directionConfidence: number | null;
  edited: boolean;
}

export interface IncisionResultViewState {
  candidateType: string;
  candidateLength: string;
  candidateWidth: string;
  candidateTipAngle: string;
  directionConfidence: string;
  directionTitle: string;
  region: string;
  regionTitle: string;
  guardrailLabel: string;
  guardrailWarn: boolean;
  llmSummary: string;
  directionSource: string;
  directionSourceWarn: boolean;
  agentGate: string;
  agentGateWarn: boolean;
  agentGateTitle: string;
  agentComparison: string;
  agentComparisonWarn: boolean;
  agentComparisonTitle: string;
  nextStep: string;
  guardrailDetails: string;
  guardrailDetailsWarn: boolean;
  guardrailDetailsDanger: boolean;
}

export interface IncisionSavedCandidateSummary {
  id: string;
  title: string;
  statusLabel: string;
  statusDanger: boolean;
  meta: string;
}

export interface IncisionWorkflowRuntime {
  executor: string;
  worker: boolean;
  thread: string;
  error: string | null;
}

export interface IncisionControllerSnapshot {
  schema_version: "react-incision-controller-snapshot/v0.1";
  reason: string;
  stageStatus: string;
  assetLoading: IncisionAssetLoadingState;
  tumor: IncisionTumorState;
  secondaryCue: IncisionSecondaryCueState;
  privacyAudit: IncisionPrivacyAuditState;
  provider: IncisionProviderState;
  review: IncisionReviewState;
  edit: IncisionEditState;
  candidate: IncisionCandidateSummary | null;
  resultView: IncisionResultViewState;
  savedCandidates: IncisionSavedCandidateSummary[];
  workflowRuntime: IncisionWorkflowRuntime | null;
  savedCount: number;
  updatedAt: string;
}

interface IncisionStoreState {
  snapshot: IncisionControllerSnapshot | null;
  setControllerSnapshot: (snapshot: IncisionControllerSnapshot) => void;
  clearControllerSnapshot: () => void;
}

export const INCISION_CONTROLLER_STATE_EVENT = "langerface:incision-state";

export const INCISION_STORE_BOUNDARY_NOTE = [
  "Zustand stores low-frequency incision workbench state only.",
  "No Three.js objects, WebGL contexts, MediaPipe task instances, canonical vertices, triangles, or per-frame arrays belong here.",
].join(" ");

export const useIncisionStore = create<IncisionStoreState>((set) => ({
  snapshot: null,
  setControllerSnapshot: (snapshot) => set({ snapshot }),
  clearControllerSnapshot: () => set({ snapshot: null }),
}));
