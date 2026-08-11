import { assetUrls } from "./assetLoader.ts";
import { dataSource, type HeadMeshPayload, type MeshTopologyPayload } from "./dataSource.ts";
import { facesArray, flameForward, loadFlameBasis } from "./flameFit.ts";
import { parseMeshFile, type ParsedMesh } from "./meshIo.ts";
import type { AnnotationTopology } from "./annotationModel.ts";
import type { Triangle, Vec3 } from "./softBody.ts";
import { topologyMeta, type TopologyMeta } from "./topologyRegistry.ts";

export type AnnotationFlameSource = "neutral" | "fitted";
export type AnnotationFlameAssetName =
  | "topology_flame_2023"
  | "flame_neutral_vertices"
  | "flame_fitted_vertices";

export interface AnnotationMeshResult {
  vertices: Vec3[];
  triangles: Triangle[];
  colors: Vec3[] | null;
  topology: AnnotationTopology | null;
  canonical: boolean;
  modeLabel: string;
  hint: string;
}

export type AnnotationFlameLoadResult =
  | { status: "loaded"; mesh: AnnotationMeshResult }
  | { status: "unavailable"; message: string };

interface RawMesh {
  vertices: Vec3[];
  triangles: Triangle[];
}

type FetchJson = <T>(url: string, label: string) => Promise<T>;

export interface AnnotationMeshServiceOptions {
  flameAssetUrl: (name: AnnotationFlameAssetName) => string | null;
  loadBundledMesh?: () => Promise<RawMesh>;
  loadFallbackHead?: () => Promise<HeadMeshPayload>;
  parseFile?: (file: File) => Promise<ParsedMesh>;
  fetchJson?: FetchJson;
  lookupTopology?: (id: string) => TopologyMeta | null;
}

const FLAME_UNAVAILABLE_MESSAGE =
  "FLAME 资产未生成（dev-local）。本地放好 assets/flame/flame2023_Open.pkl 后运行 tools/export_flame_topology.py（个体网格再跑 fit_flame_to_landmarks.py）。";

const FLAME_SOURCE = {
  neutral: {
    asset: "flame_neutral_vertices",
    fallbackLabel: "高精度三维头模",
  },
  fitted: {
    asset: "flame_fitted_vertices",
    fallbackLabel: "FLAME 个体（拟合）",
  },
} as const satisfies Record<AnnotationFlameSource, {
  asset: AnnotationFlameAssetName;
  fallbackLabel: string;
}>;

async function loadDefaultBundledMesh(): Promise<RawMesh> {
  const basis = await loadFlameBasis(assetUrls.flameBasis);
  return {
    vertices: flameForward(
      basis,
      new Float64Array(basis.NS),
      new Float64Array(basis.NE),
      0,
    ),
    triangles: facesArray(basis),
  };
}

export async function fetchAnnotationMeshJson<T>(
  url: string,
  label: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${label}加载失败：HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export class AnnotationMeshService {
  private readonly flameAssetUrl: AnnotationMeshServiceOptions["flameAssetUrl"];
  private readonly loadBundledMesh: NonNullable<AnnotationMeshServiceOptions["loadBundledMesh"]>;
  private readonly loadFallbackHead: NonNullable<AnnotationMeshServiceOptions["loadFallbackHead"]>;
  private readonly parseFile: NonNullable<AnnotationMeshServiceOptions["parseFile"]>;
  private readonly fetchJson: FetchJson;
  private readonly lookupTopology: NonNullable<AnnotationMeshServiceOptions["lookupTopology"]>;
  private bundledMeshPromise: Promise<RawMesh> | null = null;

  constructor(options: AnnotationMeshServiceOptions) {
    this.flameAssetUrl = options.flameAssetUrl;
    this.loadBundledMesh = options.loadBundledMesh ?? loadDefaultBundledMesh;
    this.loadFallbackHead = options.loadFallbackHead ?? (() => dataSource.getHeadMesh("mediapipe-468"));
    this.parseFile = options.parseFile ?? parseMeshFile;
    this.fetchJson = options.fetchJson ?? fetchAnnotationMeshJson;
    this.lookupTopology = options.lookupTopology ?? topologyMeta;
  }

  flameLabel(source: AnnotationFlameSource): string {
    if (source === "neutral") {
      return this.lookupTopology("flame-2023")?.label ?? FLAME_SOURCE.neutral.fallbackLabel;
    }
    return FLAME_SOURCE.fitted.fallbackLabel;
  }

  flameAvailable(source: AnnotationFlameSource): boolean {
    return Boolean(
      this.flameAssetUrl("topology_flame_2023")
      && this.flameAssetUrl(FLAME_SOURCE[source].asset),
    );
  }

  async loadCanonical(): Promise<AnnotationMeshResult> {
    try {
      const mesh = await this.getBundledMesh();
      const meta = this.requireFlameTopology();
      return {
        ...mesh,
        colors: null,
        topology: { topologyId: meta.id, topologyVersion: meta.version },
        canonical: true,
        modeLabel: "高精度标准图谱",
        hint: `在标准三维面部模型上点击落点（${mesh.vertices.length} 个采样点）；导出可得待复核图谱草案。`,
      };
    } catch {
      const head = await this.loadFallbackHead();
      return {
        vertices: head.vertices,
        triangles: head.triangles,
        colors: null,
        topology: head.topology,
        canonical: true,
        modeLabel: "基础标准图谱",
        hint: "已回退到基础标准脸；可导出待复核图谱草案。",
      };
    }
  }

  async loadFlame(source: AnnotationFlameSource): Promise<AnnotationFlameLoadResult> {
    const definition = FLAME_SOURCE[source];
    const vertexUrl = this.flameAssetUrl(definition.asset);
    const topologyUrl = this.flameAssetUrl("topology_flame_2023");
    if (!vertexUrl || !topologyUrl) {
      return { status: "unavailable", message: FLAME_UNAVAILABLE_MESSAGE };
    }

    const label = this.flameLabel(source);
    const [vertices, topology] = await Promise.all([
      this.fetchJson<Vec3[]>(vertexUrl, label),
      this.fetchJson<MeshTopologyPayload>(topologyUrl, "FLAME 拓扑"),
    ]);
    const meta = this.requireFlameTopology();
    const vertexCount = Number(topology.vertexCount) || vertices.length;
    return {
      status: "loaded",
      mesh: {
        vertices,
        triangles: topology.triangles,
        colors: null,
        topology: { topologyId: meta.id, topologyVersion: meta.version },
        canonical: true,
        modeLabel: label,
        hint: `在 ${label} 上点击落点（${vertexCount} 顶点）；导出得 flame-2023 图谱(tri,u,v)。`,
      },
    };
  }

  async loadFile(file: File): Promise<AnnotationMeshResult> {
    const mesh = await this.parseFile(file);
    return {
      ...mesh,
      topology: null,
      canonical: false,
      modeLabel: "自定义头模",
      hint: `已载入 ${file.name}：${mesh.vertices.length} 顶点 / ${mesh.triangles.length} 三角面。导出为 xyz 折线。`,
    };
  }

  private getBundledMesh(): Promise<RawMesh> {
    if (!this.bundledMeshPromise) {
      this.bundledMeshPromise = this.loadBundledMesh().catch((error) => {
        this.bundledMeshPromise = null;
        throw error;
      });
    }
    return this.bundledMeshPromise;
  }

  private requireFlameTopology(): TopologyMeta {
    const meta = this.lookupTopology("flame-2023");
    if (!meta) throw new Error("缺少 FLAME 拓扑登记");
    return meta;
  }
}
