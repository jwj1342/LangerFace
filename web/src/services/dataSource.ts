// Browser boundary for immutable assets and transient cross-workbench payloads.
// It intentionally exposes no patient/case record persistence API.

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
  atlasVersion?: string;
  lines: unknown[];
  [key: string]: unknown;
}

export type DataSourceLoadOptions = AssetLoadOptions;

export interface BrowserDataSource {
  listHeads(): Promise<HeadDescriptor[]>;
  getHeadMesh(id?: string, options?: DataSourceLoadOptions): Promise<HeadMeshPayload>;
  loadTopology(id?: string, options?: DataSourceLoadOptions): Promise<MeshTopologyPayload>;
  loadAtlas(system: string, options?: DataSourceLoadOptions): Promise<AtlasPayload>;
  stagePreviewAtlas(atlas: PreviewAtlasPayload): boolean;
  takePreviewAtlas(): PreviewAtlasPayload | null;
  stageIncisionOverlay(overlay: IncisionOverlayPayload): boolean;
  loadIncisionOverlay(): IncisionOverlayPayload | null;
  clearIncisionOverlay(): void;
}

const PREVIEW_ATLAS_KEY = "langerface.previewAtlas";
const INCISION_OVERLAY_KEY = "langerface.incisionOverlay";

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
