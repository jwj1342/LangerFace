import { requireScopedElement, requireScopedQuery } from "../lib/scopedDom";

export interface IncisionDomElements extends Record<string, any> {
  canvas: HTMLCanvasElement;
  photoCanvas: HTMLCanvasElement;
  photoCandidateCanvas: HTMLCanvasElement;
  photoEndpointHandles: NodeListOf<HTMLButtonElement>;
  photoInput: HTMLInputElement;
  controlledMarkerDetect: HTMLButtonElement;
  controlledMarkerScanControl: HTMLElement;
  controlledMarkerScanDiameter: HTMLInputElement;
  controlledMarkerScanValue: HTMLOutputElement;
  controlledMarkerScanOverlay: HTMLElement;
  controlledMarkerScanOverlayLabel: HTMLElement;
  photoMirror: HTMLButtonElement;
  photoReset: HTMLButtonElement;
  surfaceMode: HTMLButtonElement;
  photoStatus: HTMLElement;
  wrap: HTMLElement;
  assetLoading: HTMLElement;
  assetLoadingText: HTMLElement;
  tumorKind: HTMLSelectElement;
  diameter: HTMLInputElement;
  diameterVal: HTMLElement;
  tumorAuthor: HTMLInputElement;
  depth: HTMLInputElement;
  depthVal: HTMLElement;
  depthWrap: HTMLElement;
  margin: HTMLInputElement;
  marginVal: HTMLElement;
  marginWrap: HTMLElement;
  boundaryWrap: HTMLElement;
  boundaryMode: HTMLSelectElement;
  ellipseWrap: HTMLElement;
  ellipseRatio: HTMLInputElement;
  ellipseRatioVal: HTMLElement;
  freehandControls: HTMLElement;
  startBoundary: HTMLButtonElement;
  clearBoundary: HTMLButtonElement;
  boundaryStatus: HTMLElement;
  exportTumor: HTMLButtonElement;
  importTumor: HTMLButtonElement;
  tumorImportFile: HTMLInputElement;
  run: HTMLButtonElement;
  pickState: HTMLElement;
  anatomyPreview: HTMLElement;
  secondaryCueState: HTMLElement;
  secondaryCueSummary: HTMLElement;
  importSecondaryCue: HTMLButtonElement;
  clearSecondaryCue: HTMLButtonElement;
  secondaryCueImportFile: HTMLInputElement;
  secondaryCueConfirmed: HTMLInputElement;
  candidateType: HTMLElement;
  candidateLength: HTMLElement;
  candidateWidth: HTMLElement;
  candidateTipAngle: HTMLElement;
  candidateRstlDeviation: HTMLElement;
  directionConf: HTMLElement;
  regionVal: HTMLElement;
  guardrailVal: HTMLElement;
  directionSource: HTMLElement;
  workflowGate: HTMLElement;
  workflowComparison: HTMLElement;
  guardrailDetails: HTMLElement;
  workflowSummary: HTMLElement;
  nextStep: HTMLElement;
  editStatus: HTMLElement;
  angleOffset: HTMLInputElement;
  angleOffsetVal: HTMLElement;
  lengthScale: HTMLInputElement;
  lengthScaleVal: HTMLElement;
  widthScale: HTMLInputElement;
  widthScaleVal: HTMLElement;
  widthScaleWrap: HTMLElement;
  tipAngle: HTMLInputElement;
  tipAngleVal: HTMLElement;
  tipAngleWrap: HTMLElement;
  shiftAlong: HTMLInputElement;
  shiftAlongVal: HTMLElement;
  shiftPerp: HTMLInputElement;
  shiftPerpVal: HTMLElement;
  editReason: HTMLSelectElement;
  undoEdit: HTMLButtonElement;
  redoEdit: HTMLButtonElement;
  resetEdit: HTMLButtonElement;
  editHistoryState: HTMLElement;
  reviewerName: HTMLInputElement;
  reviewDecision: HTMLSelectElement;
  reviewNotes: HTMLTextAreaElement;
  reviewState: HTMLElement;
  saveReview: HTMLButtonElement;
  saveCandidate: HTMLButtonElement;
  makeVariants: HTMLButtonElement;
  clearSaved: HTMLButtonElement;
  exportJson: HTMLButtonElement;
  exportReport: HTMLButtonElement;
  exportPng: HTMLButtonElement;
  stageLiveOverlay: HTMLButtonElement;
  candidateList: HTMLElement;
  savedCount: HTMLElement;
  privacyState: HTMLElement;
  privacyAudit: HTMLElement;
  stageStatus: HTMLElement;
}

const byId = <T extends Element = HTMLElement>(root: ParentNode | Document, id: string): T => {
  return requireScopedElement<T>(root, id);
};

export function collectIncisionElements(root: ParentNode | Document = document): IncisionDomElements {
  return {
    canvas: byId<HTMLCanvasElement>(root, "incisionCanvas"),
    photoCanvas: byId<HTMLCanvasElement>(root, "incisionPhotoCanvas"),
    photoCandidateCanvas: byId<HTMLCanvasElement>(root, "incisionCandidateCanvas"),
    photoEndpointHandles: root.querySelectorAll<HTMLButtonElement>(".incision-photo-endpoint-handle"),
    photoInput: byId<HTMLInputElement>(root, "incisionPhotoInput"),
    controlledMarkerDetect: byId<HTMLButtonElement>(root, "controlledMarkerDetectBtn"),
    controlledMarkerScanControl: requireScopedQuery<HTMLElement>(root, ".controlled-marker-scan-control"),
    controlledMarkerScanDiameter: byId<HTMLInputElement>(root, "controlledMarkerScanDiameter"),
    controlledMarkerScanValue: byId<HTMLOutputElement>(root, "controlledMarkerScanValue"),
    controlledMarkerScanOverlay: byId(root, "controlledMarkerScanOverlay"),
    controlledMarkerScanOverlayLabel: byId(root, "controlledMarkerScanOverlayLabel"),
    photoMirror: byId<HTMLButtonElement>(root, "incisionPhotoMirrorBtn"),
    photoReset: byId<HTMLButtonElement>(root, "incisionPhotoResetBtn"),
    surfaceMode: byId<HTMLButtonElement>(root, "incisionSurfaceModeBtn"),
    photoStatus: byId(root, "incisionPhotoStatus"),
    wrap: requireScopedQuery<HTMLElement>(root, ".main-wrap"),
    assetLoading: byId(root, "assetLoading"),
    assetLoadingText: byId(root, "assetLoadingText"),
    tumorKind: byId(root, "tumorKind"),
    diameter: byId(root, "diameterMm"),
    diameterVal: byId(root, "diameterVal"),
    tumorAuthor: byId(root, "tumorAuthor"),
    depth: byId(root, "depthMm"),
    depthVal: byId(root, "depthVal"),
    depthWrap: byId(root, "depthWrap"),
    margin: byId(root, "marginMm"),
    marginVal: byId(root, "marginVal"),
    marginWrap: byId(root, "marginWrap"),
    boundaryWrap: byId(root, "boundaryWrap"),
    boundaryMode: byId(root, "boundaryMode"),
    ellipseWrap: byId(root, "ellipseWrap"),
    ellipseRatio: byId(root, "ellipseRatio"),
    ellipseRatioVal: byId(root, "ellipseRatioVal"),
    freehandControls: byId(root, "freehandControls"),
    startBoundary: byId(root, "startBoundaryBtn"),
    clearBoundary: byId(root, "clearBoundaryBtn"),
    boundaryStatus: byId(root, "boundaryStatus"),
    exportTumor: byId(root, "exportTumorBtn"),
    importTumor: byId(root, "importTumorBtn"),
    tumorImportFile: byId(root, "tumorImportFile"),
    run: byId(root, "runWorkflowBtn"),
    pickState: byId(root, "pickState"),
    anatomyPreview: byId(root, "anatomyPreview"),
    secondaryCueState: byId(root, "secondaryCueState"),
    secondaryCueSummary: byId(root, "secondaryCueSummary"),
    importSecondaryCue: byId(root, "importSecondaryCueBtn"),
    clearSecondaryCue: byId(root, "clearSecondaryCueBtn"),
    secondaryCueImportFile: byId(root, "secondaryCueImportFile"),
    secondaryCueConfirmed: byId(root, "secondaryCueConfirmed"),
    candidateType: byId(root, "candidateType"),
    candidateLength: byId(root, "candidateLength"),
    candidateWidth: byId(root, "candidateWidth"),
    candidateTipAngle: byId(root, "candidateTipAngle"),
    candidateRstlDeviation: byId(root, "candidateRstlDeviation"),
    directionConf: byId(root, "directionConf"),
    regionVal: byId(root, "regionVal"),
    guardrailVal: byId(root, "guardrailVal"),
    directionSource: byId(root, "directionSource"),
    workflowGate: byId(root, "workflowGate"),
    workflowComparison: byId(root, "workflowComparison"),
    guardrailDetails: byId(root, "guardrailDetails"),
    workflowSummary: byId(root, "workflowSummary"),
    nextStep: byId(root, "nextStep"),
    editStatus: byId(root, "editStatus"),
    angleOffset: byId(root, "angleOffsetDeg"),
    angleOffsetVal: byId(root, "angleOffsetVal"),
    lengthScale: byId(root, "lengthScale"),
    lengthScaleVal: byId(root, "lengthScaleVal"),
    widthScale: byId(root, "widthScale"),
    widthScaleVal: byId(root, "widthScaleVal"),
    widthScaleWrap: byId(root, "widthScaleWrap"),
    tipAngle: byId(root, "tipAngleDeg"),
    tipAngleVal: byId(root, "tipAngleVal"),
    tipAngleWrap: byId(root, "tipAngleWrap"),
    shiftAlong: byId(root, "shiftAlongMm"),
    shiftAlongVal: byId(root, "shiftAlongVal"),
    shiftPerp: byId(root, "shiftPerpMm"),
    shiftPerpVal: byId(root, "shiftPerpVal"),
    editReason: byId(root, "editReason"),
    undoEdit: byId(root, "undoEditBtn"),
    redoEdit: byId(root, "redoEditBtn"),
    resetEdit: byId(root, "resetEditBtn"),
    editHistoryState: byId(root, "editHistoryState"),
    reviewerName: byId(root, "reviewerName"),
    reviewDecision: byId(root, "reviewDecision"),
    reviewNotes: byId(root, "reviewNotes"),
    reviewState: byId(root, "reviewState"),
    saveReview: byId(root, "saveReviewBtn"),
    saveCandidate: byId(root, "saveCandidateBtn"),
    makeVariants: byId(root, "makeVariantsBtn"),
    clearSaved: byId(root, "clearSavedBtn"),
    exportJson: byId(root, "exportJsonBtn"),
    exportReport: byId(root, "exportReportBtn"),
    exportPng: byId(root, "exportPngBtn"),
    stageLiveOverlay: byId(root, "stageLiveOverlayBtn"),
    candidateList: byId(root, "candidateList"),
    savedCount: byId(root, "savedCount"),
    privacyState: byId(root, "privacyState"),
    privacyAudit: byId(root, "privacyAudit"),
    stageStatus: byId(root, "stageStatus"),
  };
}
