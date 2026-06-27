// Browser data source boundary for transient cross-workbench payloads.
// The current implementation is local-only; callers should depend on the
// BrowserDataSource contract so a remote source can replace it later.

import { loadJsonAsset, type AssetLoadOptions } from "./assetLoader.ts";
import { TOPOLOGY_ID, TOPOLOGY_VERSION } from "./constants.ts";
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
}

interface LocalHeadDescriptor extends HeadDescriptor {
  vertexAsset: string;
  topologyAsset: string;
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

export type DataSourceLoadOptions = AssetLoadOptions;

export interface BrowserDataSource {
  listHeads(): Promise<HeadDescriptor[]>;
  getHeadMesh(id?: string, options?: DataSourceLoadOptions): Promise<HeadMeshPayload>;
  loadTopology(id?: string, options?: DataSourceLoadOptions): Promise<MeshTopologyPayload>;
  loadAtlas(system: string, options?: DataSourceLoadOptions): Promise<AtlasPayload>;
  saveAnnotation(payload: Record<string, unknown>): AnnotationRecord | null;
  listAnnotations(query?: AnnotationQuery): AnnotationRecord[];
  stagePreviewAtlas(atlas: PreviewAtlasPayload): boolean;
  takePreviewAtlas(): PreviewAtlasPayload | null;
  stageIncisionOverlay(overlay: IncisionOverlayPayload): boolean;
  loadIncisionOverlay(): IncisionOverlayPayload | null;
  clearIncisionOverlay(): void;
}

const PREVIEW_ATLAS_KEY = "langerface.previewAtlas";
const INCISION_OVERLAY_KEY = "langerface.incisionOverlay";
const ANNOTATIONS_KEY = "langerface.annotations";

const HEADS: LocalHeadDescriptor[] = [
  {
    id: "mediapipe-468",
    label: "MediaPipe 标准脸",
    topologyId: TOPOLOGY_ID,
    topologyVersion: TOPOLOGY_VERSION,
    vertexAsset: "canonicalVertices",
    topologyAsset: "topology",
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

async function loadHeadTopology(
  id = "mediapipe-468",
  { onProgress }: DataSourceLoadOptions = {},
): Promise<MeshTopologyPayload> {
  const head = headById(id);
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
    return HEADS.map(({ id, label, topologyId, topologyVersion }) => ({ id, label, topologyId, topologyVersion }));
  },

  async loadTopology(id = "mediapipe-468", options = {}) {
    return loadHeadTopology(id, options);
  },

  async getHeadMesh(id = "mediapipe-468", { onProgress }: DataSourceLoadOptions = {}) {
    const head = headById(id);
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
