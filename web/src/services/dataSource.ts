// Browser data source boundary for transient cross-workbench payloads.
// The current implementation is local-only; callers should depend on the
// BrowserDataSource contract so a remote source can replace it later.

import { loadJsonAsset, type AssetLoadOptions } from "./assetLoader.ts";
import { TOPOLOGY_ID, TOPOLOGY_VERSION } from "./constants.ts";
import { flameHeadMeshFromBasis, loadFlameBasisAsset } from "./flameHeadAssets.ts";
import type { Triangle, Vec3 } from "./softBody.ts";

export interface PreviewAtlasPayload {
  system: string;
  validated?: boolean;
  lines: unknown[];
  [key: string]: unknown;
}

export interface IncisionOverlayPayload {
  guardrail_summary?: {
    high_codes?: string[];
  };
  review_gate?: {
    high_guardrail_codes?: string[];
    approval_ready?: boolean;
    live_overlay_ready?: boolean;
    [key: string]: unknown;
  };
  review?: {
    status?: string;
  };
  [key: string]: unknown;
}

export interface HeadDescriptor {
  id: string;
  label: string;
  topologyId: string;
  topologyVersion: string;
  bundled?: boolean;
  assetStatus?: "bundled" | "optional" | "generated";
  clinicalStatus?: string;
}

interface LocalHeadDescriptor extends HeadDescriptor {
  kind: "json" | "flameBasis";
  vertexAsset?: string;
  topologyAsset?: string;
}

export interface MeshTopologyPayload {
  topologyId: string;
  topologyVersion: string;
  triangles: Triangle[];
  [key: string]: unknown;
}

export interface HeadMeshPayload extends HeadDescriptor {
  topology: MeshTopologyPayload;
  vertices: Vec3[];
  verts: Vec3[];
  triangles: Triangle[];
  tris: Triangle[];
}

export interface AtlasPayload {
  system?: string;
  version?: string;
  lines: unknown[];
  [key: string]: unknown;
}

export interface AnnotationRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  system?: string;
  topologyId?: string;
  [key: string]: unknown;
}

export interface AnnotationQuery {
  system?: string;
  topologyId?: string;
}

export type ClinicalCaseStep = "evaluate" | "plan" | "review";
export type ClinicalCaseStatus = "draft" | "needs_review" | "confirmed" | "exported";
export type LesionLayer = "subcutaneous" | "cutaneous";
export type MarginStrategy = "complete_excision" | "expanded_margin";
export type ClosureSimulationStatus = "not_run" | "stable" | "needs_review";

export interface ClinicalCaseRecord {
  id: string;
  title: string;
  status: ClinicalCaseStatus;
  currentStep: ClinicalCaseStep;
  createdAt: string;
  updatedAt: string;
  patientContext: {
    ageYears: number | null;
    ageBand: "child_tight" | "adult_standard" | "older_lax" | "unknown";
    ageBandLabel: string;
    parameterHint: string;
  };
  lesion: {
    layer: LesionLayer;
    layerLabel: string;
    diameterMm: number | null;
    depthMm: number | null;
    marginStrategy: MarginStrategy;
    safetyMarginMm: number | null;
  };
  acquisition: {
    source: "upload" | "photo" | "scan3d" | "realtime";
    sourceLabel: string;
  };
  layers: {
    rstl: boolean;
    personalizedWrinkles: boolean;
    blendedField: boolean;
    incisionDesign: boolean;
  };
  closureSimulation: {
    status: ClosureSimulationStatus;
    score: number | null;
    label: string;
    summary: string;
    lastRunAt: string | null;
  };
  saveState?: "saved" | "dirty" | "save_failed";
  lastError?: string;
}

export interface ClinicalCaseDraft {
  id?: string;
  title?: string;
  status?: ClinicalCaseStatus;
  currentStep?: ClinicalCaseStep;
  createdAt?: string;
  updatedAt?: string;
  patientContext?: Partial<ClinicalCaseRecord["patientContext"]>;
  lesion?: Partial<ClinicalCaseRecord["lesion"]>;
  acquisition?: Partial<ClinicalCaseRecord["acquisition"]>;
  layers?: Partial<ClinicalCaseRecord["layers"]>;
  closureSimulation?: Partial<ClinicalCaseRecord["closureSimulation"]>;
  saveState?: ClinicalCaseRecord["saveState"];
  lastError?: string;
}

export type DataSourceLoadOptions = AssetLoadOptions;

export interface BrowserDataSource {
  listHeads(): Promise<HeadDescriptor[]>;
  getHeadMesh(id?: string, options?: DataSourceLoadOptions): Promise<HeadMeshPayload>;
  loadTopology(id?: string, options?: DataSourceLoadOptions): Promise<MeshTopologyPayload>;
  loadAtlas(system: string, options?: DataSourceLoadOptions): Promise<AtlasPayload>;
  saveAnnotation(payload: Record<string, unknown>): AnnotationRecord | null;
  listAnnotations(query?: AnnotationQuery): AnnotationRecord[];
  saveCase(payload: ClinicalCaseDraft): ClinicalCaseRecord | null;
  listCases(): ClinicalCaseRecord[];
  getCase(id: string): ClinicalCaseRecord | null;
  stagePreviewAtlas(atlas: PreviewAtlasPayload): boolean;
  takePreviewAtlas(): PreviewAtlasPayload | null;
  stageIncisionOverlay(overlay: IncisionOverlayPayload): boolean;
  loadIncisionOverlay(): IncisionOverlayPayload | null;
  clearIncisionOverlay(): void;
}

const PREVIEW_ATLAS_KEY = "langerface.previewAtlas";
const INCISION_OVERLAY_KEY = "langerface.incisionOverlay";
const ANNOTATIONS_KEY = "langerface.annotations";
const CASES_KEY = "langerface.cases";

const HEADS: LocalHeadDescriptor[] = [
  {
    id: "mediapipe-468",
    label: "标准三维面部模型",
    topologyId: TOPOLOGY_ID,
    topologyVersion: TOPOLOGY_VERSION,
    bundled: true,
    assetStatus: "bundled",
    clinicalStatus: "draft_not_clinically_validated",
    kind: "json",
    vertexAsset: "canonicalVertices",
    topologyAsset: "topology",
  },
  {
    id: "flame-2023",
    label: "高精度三维头模",
    topologyId: "flame-2023",
    topologyVersion: "flame-2023-v1",
    bundled: true,
    assetStatus: "generated",
    clinicalStatus: "research_preview_not_clinically_validated",
    kind: "flameBasis",
  },
];

function hasSessionStorage(): boolean {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage !== null;
  } catch {
    return false;
  }
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage !== null;
  } catch {
    return false;
  }
}

function headById(id = "mediapipe-468"): LocalHeadDescriptor {
  const head = HEADS.find((item) => item.id === id);
  if (!head) throw new Error(`未知头模数据源：${id}`);
  return head;
}

function atlasAsset(system: string): string {
  if (system === "rstl") return "atlasRstl";
  if (system === "langer") return "atlasLanger";
  throw new Error(`未知图谱系统：${system}`);
}

function readSessionJson<T>(key: string, remove = false): T | null {
  if (!hasSessionStorage()) return null;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  if (remove) sessionStorage.removeItem(key);
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeSessionJson(key: string, value: unknown): boolean {
  if (!hasSessionStorage()) return false;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readLocalJson<T>(key: string, fallback: T): T {
  if (!hasLocalStorage()) return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocalJson(key: string, value: unknown): boolean {
  if (!hasLocalStorage()) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function createId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `${prefix}_${randomId}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function classifyCaseAge(ageYears: number | null | undefined): ClinicalCaseRecord["patientContext"] {
  if (typeof ageYears !== "number" || !Number.isFinite(ageYears) || ageYears < 0) {
    return {
      ageYears: null,
      ageBand: "unknown",
      ageBandLabel: "未填写年龄",
      parameterHint: "填写年龄后，系统会显示对应的梭形夹角和长轴:短轴参数提示。",
    };
  }
  const roundedAge = Math.round(ageYears);
  if (roundedAge <= 17) {
    return {
      ageYears: roundedAge,
      ageBand: "child_tight",
      ageBandLabel: "儿童 / 紧致",
      parameterHint: "提示缩小梭形切口夹角；长轴:短轴建议为 3.5:1。",
    };
  }
  if (roundedAge >= 60) {
    return {
      ageYears: roundedAge,
      ageBand: "older_lax",
      ageBandLabel: "老年 / 松弛",
      parameterHint: "提示适当增加梭形切口夹角；长轴:短轴建议为 2.5:1。",
    };
  }
  return {
    ageYears: roundedAge,
    ageBand: "adult_standard",
    ageBandLabel: "中青年 / 普通",
    parameterHint: "维持基础参数；当前对应 30° 尖端角和 3:1 长轴:短轴。",
  };
}

function lesionLayerLabel(layer: LesionLayer): string {
  return layer === "subcutaneous" ? "皮下肿物 · 线性切口模式" : "皮表肿物 · 梭形切口模式";
}

function acquisitionLabel(source: ClinicalCaseRecord["acquisition"]["source"]): string {
  if (source === "photo") return "标准位拍照";
  if (source === "scan3d") return "3D 扫描";
  if (source === "realtime") return "实时 AR 跟踪";
  return "上传照片 / 视频";
}

function normalizeCaseRecord(payload: ClinicalCaseDraft, now = new Date().toISOString()): ClinicalCaseRecord {
  const layer: LesionLayer = payload.lesion?.layer === "cutaneous" ? "cutaneous" : "subcutaneous";
  const marginStrategy: MarginStrategy = payload.lesion?.marginStrategy === "expanded_margin"
    ? "expanded_margin"
    : "complete_excision";
  const source = payload.acquisition?.source === "photo"
    || payload.acquisition?.source === "scan3d"
    || payload.acquisition?.source === "realtime"
    ? payload.acquisition.source
    : "upload";
  const patientContext = classifyCaseAge(payload.patientContext?.ageYears);

  return {
    id: typeof payload.id === "string" ? payload.id : createId("case"),
    title: typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : "未命名面部评估",
    status: payload.status ?? "draft",
    currentStep: payload.currentStep ?? "evaluate",
    createdAt: typeof payload.createdAt === "string" ? payload.createdAt : now,
    updatedAt: now,
    patientContext,
    lesion: {
      layer,
      layerLabel: lesionLayerLabel(layer),
      diameterMm: typeof payload.lesion?.diameterMm === "number" ? payload.lesion.diameterMm : null,
      depthMm: typeof payload.lesion?.depthMm === "number" ? payload.lesion.depthMm : null,
      marginStrategy,
      safetyMarginMm: typeof payload.lesion?.safetyMarginMm === "number" ? payload.lesion.safetyMarginMm : null,
    },
    acquisition: {
      source,
      sourceLabel: acquisitionLabel(source),
    },
    layers: {
      rstl: payload.layers?.rstl ?? true,
      personalizedWrinkles: payload.layers?.personalizedWrinkles ?? true,
      blendedField: payload.layers?.blendedField ?? false,
      incisionDesign: payload.layers?.incisionDesign ?? true,
    },
    closureSimulation: {
      status: payload.closureSimulation?.status ?? "not_run",
      score: typeof payload.closureSimulation?.score === "number" ? payload.closureSimulation.score : null,
      label: typeof payload.closureSimulation?.label === "string" ? payload.closureSimulation.label : "待运行",
      summary: typeof payload.closureSimulation?.summary === "string"
        ? payload.closureSimulation.summary
        : "生成候选切口后，可在本步骤内运行张力闭合模拟。",
      lastRunAt: typeof payload.closureSimulation?.lastRunAt === "string" ? payload.closureSimulation.lastRunAt : null,
    },
    saveState: "saved",
  };
}

async function loadHeadTopology(
  id = "mediapipe-468",
  { onProgress }: DataSourceLoadOptions = {},
): Promise<MeshTopologyPayload> {
  const head = headById(id);
  if (head.kind === "flameBasis") {
    const basis = await loadFlameBasisAsset({ label: `${head.label} basis`, onProgress });
    const mesh = flameHeadMeshFromBasis(basis);
    return {
      ...mesh.topology,
      topologyId: head.topologyId,
      topologyVersion: head.topologyVersion,
    };
  }
  if (!head.topologyAsset) throw new Error(`头模缺少拓扑资产：${id}`);
  const topology = await loadJsonAsset<MeshTopologyPayload | Triangle[]>(head.topologyAsset, {
    label: `${head.label}拓扑`,
    onProgress,
  });
  return Array.isArray(topology)
    ? { topologyId: head.topologyId, topologyVersion: head.topologyVersion, triangles: topology }
    : {
        ...topology,
        topologyId: topology.topologyId ?? head.topologyId,
        topologyVersion: topology.topologyVersion ?? head.topologyVersion,
        triangles: topology.triangles,
      };
}

export const LocalDataSource: BrowserDataSource = {
  async listHeads() {
    return HEADS.map(({ id, label, topologyId, topologyVersion, bundled, assetStatus, clinicalStatus }) => ({
      id,
      label,
      topologyId,
      topologyVersion,
      bundled,
      assetStatus,
      clinicalStatus,
    }));
  },

  async loadTopology(id = "mediapipe-468", options = {}) {
    return loadHeadTopology(id, options);
  },

  async getHeadMesh(id = "mediapipe-468", { onProgress }: DataSourceLoadOptions = {}) {
    const head = headById(id);
    if (head.kind === "flameBasis") {
      const basis = await loadFlameBasisAsset({ label: `${head.label} basis`, onProgress });
      const mesh = flameHeadMeshFromBasis(basis);
      return {
        id: head.id,
        label: head.label,
        topologyId: head.topologyId,
        topologyVersion: head.topologyVersion,
        ...mesh,
        topology: {
          ...mesh.topology,
          topologyId: head.topologyId,
          topologyVersion: head.topologyVersion,
        },
      };
    }
    if (!head.vertexAsset) throw new Error(`头模缺少顶点资产：${id}`);
    const [vertices, topology] = await Promise.all([
      loadJsonAsset<Vec3[]>(head.vertexAsset, { label: `${head.label}顶点`, onProgress }),
      loadHeadTopology(id, { onProgress }),
    ]);
    return {
      id: head.id,
      label: head.label,
      topologyId: topology.topologyId,
      topologyVersion: topology.topologyVersion,
      topology,
      vertices,
      verts: vertices,
      triangles: topology.triangles,
      tris: topology.triangles,
    };
  },

  async loadAtlas(system, options = {}) {
    return loadJsonAsset<AtlasPayload>(atlasAsset(system), {
      label: `${system.toUpperCase()} 图谱`,
      ...options,
    });
  },

  saveAnnotation(payload) {
    if (!payload || typeof payload !== "object") return null;
    const now = new Date().toISOString();
    const existing = readLocalJson<AnnotationRecord[]>(ANNOTATIONS_KEY, []);
    const record: AnnotationRecord = {
      ...payload,
      id: typeof payload.id === "string"
        ? payload.id
        : `ann_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: typeof payload.createdAt === "string" ? payload.createdAt : now,
      updatedAt: now,
      system: typeof payload.system === "string" ? payload.system : undefined,
      topologyId: typeof payload.topologyId === "string" ? payload.topologyId : undefined,
    };
    const next = existing.filter((item) => item?.id !== record.id);
    next.push(record);
    return writeLocalJson(ANNOTATIONS_KEY, next) ? record : null;
  },

  listAnnotations(query = {}) {
    return readLocalJson<AnnotationRecord[]>(ANNOTATIONS_KEY, []).filter((item) => {
      if (query.system && item?.system !== query.system) return false;
      if (query.topologyId && item?.topologyId !== query.topologyId) return false;
      return true;
    });
  },

  saveCase(payload) {
    const existing = readLocalJson<ClinicalCaseRecord[]>(CASES_KEY, []);
    const previous = typeof payload.id === "string"
      ? existing.find((item) => item.id === payload.id)
      : undefined;
    const record = normalizeCaseRecord({
      ...previous,
      ...payload,
      patientContext: { ...previous?.patientContext, ...payload.patientContext },
      lesion: { ...previous?.lesion, ...payload.lesion },
      acquisition: { ...previous?.acquisition, ...payload.acquisition },
      layers: { ...previous?.layers, ...payload.layers },
      closureSimulation: { ...previous?.closureSimulation, ...payload.closureSimulation },
      createdAt: previous?.createdAt ?? payload.createdAt,
    });
    const next = existing.filter((item) => item.id !== record.id);
    next.unshift(record);
    return writeLocalJson(CASES_KEY, next) ? record : null;
  },

  listCases() {
    return readLocalJson<ClinicalCaseRecord[]>(CASES_KEY, [])
      .map((item) => normalizeCaseRecord(item, item.updatedAt))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  getCase(id) {
    const record = readLocalJson<ClinicalCaseRecord[]>(CASES_KEY, []).find((item) => item.id === id);
    return record ? normalizeCaseRecord(record, record.updatedAt) : null;
  },

  stagePreviewAtlas(atlas) {
    return writeSessionJson(PREVIEW_ATLAS_KEY, atlas);
  },

  takePreviewAtlas() {
    return readSessionJson<PreviewAtlasPayload>(PREVIEW_ATLAS_KEY, true);
  },

  stageIncisionOverlay(overlay) {
    return writeSessionJson(INCISION_OVERLAY_KEY, overlay);
  },

  loadIncisionOverlay() {
    return readSessionJson<IncisionOverlayPayload>(INCISION_OVERLAY_KEY);
  },

  clearIncisionOverlay() {
    if (hasSessionStorage()) sessionStorage.removeItem(INCISION_OVERLAY_KEY);
  },
};

export const dataSource: BrowserDataSource = LocalDataSource;
