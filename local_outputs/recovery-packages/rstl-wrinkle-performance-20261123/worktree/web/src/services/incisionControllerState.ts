import * as THREE from "three";

import { IncisionEditHistory } from "./incisionEditHistory";
import type { IncisionDomCleanup } from "./incisionDomBindings";
import type { IncisionHeadAssetState } from "./incisionSnapshots";
import type { WorkflowWorkerClient } from "./workflowWorkerClient";
import type { PhotoPlanningController } from "./photoPlanningController";
import type { SurfaceRef } from "./incisionOverlay";
import { pointToSurfaceRef } from "./incisionOverlay";
import { surfaceRefToModelPoint } from "./incisionPhotoPlanning";
import { Head3D } from "./three3d.ts";
import type { Triangle, Vec3 } from "./softBody";

export { resetIncisionBoundaryState } from "./incisionBoundaryState";

type DynamicRecord = Record<string, any>;
type ControllerCleanup = () => void;
type IncisionMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
type IncisionLine = THREE.Line<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;

export interface IncisionPhotoViewState {
  active: boolean;
  operationId: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
  mirror: boolean;
}

export interface IncisionRuntimeState {
  mounted: boolean;
  frameId: number;
  domEventCleanup: IncisionDomCleanup | null;
  planning2d: PhotoPlanningController | null;
  photoView: IncisionPhotoViewState;
  verts: Vec3[];
  tris: Triangle[];
  atlas: DynamicRecord | null;
  headAsset: IncisionHeadAssetState | null;
  assetWarnings: string[];
  normals: Vec3[];
  meanEdge: number;
  unitsPerMm: number;
  head: Head3D | null;
  marker: IncisionMesh | null;
  tumorRing: IncisionLine | null;
  boundaryLine: IncisionLine | null;
  candidateLine: IncisionLine | null;
  endpointHandles: IncisionMesh[];
  raycaster: THREE.Raycaster;
  lesion: number;
  lesionRef: SurfaceRef | null;
  boundaryPoints: Vec3[];
  boundaryRefs: SurfaceRef[];
  boundaryActive: boolean;
  controlledBoundaryActive: boolean;
  saved: DynamicRecord[];
  result: any;
  baseResult: any;
  secondaryCues: any;
  workflowWorker: WorkflowWorkerClient | null;
  workflowWorkerFailed: boolean;
  reactCommandCleanup: ControllerCleanup | null;
  editHistory: IncisionEditHistory;
  lastConsoleTraceSignature: string;
  generationCount: number;
  workflowRequestId: number;
  activeExplicitWorkflowCount: number;
}

export function createIncisionControllerState(): IncisionRuntimeState {
  return {
    mounted: false,
    frameId: 0,
    domEventCleanup: null,
    planning2d: null,
    photoView: {
      active: false,
      operationId: 0,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      mirror: false,
    },
    verts: [],
    tris: [],
    atlas: null,
    headAsset: null,
    assetWarnings: [],
    normals: [],
    meanEdge: 1,
    unitsPerMm: 1,
    head: null,
    marker: null,
    tumorRing: null,
    boundaryLine: null,
    candidateLine: null,
    endpointHandles: [],
    raycaster: new THREE.Raycaster(),
    lesion: 0,
    lesionRef: null,
    boundaryPoints: [],
    boundaryRefs: [],
    boundaryActive: false,
    controlledBoundaryActive: false,
    saved: [],
    result: null,
    baseResult: null,
    secondaryCues: null,
    workflowWorker: null,
    workflowWorkerFailed: false,
    reactCommandCleanup: null,
    editHistory: new IncisionEditHistory(),
    lastConsoleTraceSignature: "",
    generationCount: 0,
    workflowRequestId: 0,
    activeExplicitWorkflowCount: 0,
  };
}

export function applyNormalizedLesionCenterState(state: IncisionRuntimeState, result: DynamicRecord): boolean {
  if (result?.tumor_normalization?.applied !== true) return false;
  const rawCenter = result?.tumor?.center;
  if (!Array.isArray(rawCenter) || rawCenter.length !== 3 || !rawCenter.every(Number.isFinite)) return false;
  const center = rawCenter as Vec3;
  const centerRef = pointToSurfaceRef(center, state.verts, state.tris);
  if (!centerRef) return false;
  const previous = state.lesionRef && surfaceRefToModelPoint(state.lesionRef, state.verts, state.tris);
  if (previous && Math.hypot(...center.map((value, index) => value - previous[index])) <= 1e-8) return false;
  state.lesion = state.verts.reduce((best, point, index) => (
    Math.hypot(...center.map((value, axis) => value - point[axis]))
      < Math.hypot(...center.map((value, axis) => value - state.verts[best][axis])) ? index : best
  ), 0);
  state.lesionRef = centerRef;
  const normal = state.normals[state.lesion];
  state.marker?.position.set(
    center[0] + normal[0] * state.meanEdge * 0.34,
    center[1] + normal[1] * state.meanEdge * 0.34,
    center[2] + normal[2] * state.meanEdge * 0.34,
  );
  return true;
}

export function keepUnpickedPhotoSelectionEmpty(state: IncisionRuntimeState): boolean {
  if (!state.photoView.active || state.lesionRef) return false;
  state.planning2d?.setSelection({ centerRef: null, boundaryRefs: [] });
  state.planning2d?.setOverlaySummary({ tumorVisible: false, candidatePointCount: 0 });
  return true;
}

export function resetUnpickedPhotoPlanningState(state: IncisionRuntimeState): boolean {
  if (!keepUnpickedPhotoSelectionEmpty(state)) return false;
  state.workflowRequestId += 1;
  state.result = null;
  state.baseResult = null;
  if (state.candidateLine) state.candidateLine.visible = false;
  for (const handle of state.endpointHandles) handle.visible = false;
  return true;
}
