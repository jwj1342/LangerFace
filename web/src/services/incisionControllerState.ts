import * as THREE from "three";

import { IncisionEditHistory } from "./incisionEditHistory";
import type { IncisionDomCleanup } from "./incisionDomBindings";
import type { IncisionHeadAssetState } from "./incisionSnapshots";
import type { WorkflowWorkerClient } from "./workflowWorkerClient";
import type { PhotoPlanningController } from "./photoPlanningController";
import { Head3D } from "./three3d.ts";
import type { Triangle, Vec3 } from "./softBody";

type DynamicRecord = Record<string, any>;
type ControllerCleanup = () => void;
type IncisionMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
type IncisionLine = THREE.Line<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;

export interface IncisionRuntimeState {
  mounted: boolean;
  frameId: number;
  domEventCleanup: IncisionDomCleanup | null;
  planning2d: PhotoPlanningController | null;
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
  boundaryPoints: Vec3[];
  boundaryActive: boolean;
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
}

export function createIncisionControllerState(): IncisionRuntimeState {
  return {
    mounted: false,
    frameId: 0,
    domEventCleanup: null,
    planning2d: null,
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
    boundaryPoints: [],
    boundaryActive: false,
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
  };
}
