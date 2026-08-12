import { LIVE_SNAPSHOT_SCHEMA_VERSION } from "../lib/controllerSnapshotSchemas";
import type { RstlSourceContract } from "./rstlSourceContract";

export { LIVE_SNAPSHOT_SCHEMA_VERSION };

export interface LiveTextLike {
  textContent?: string | null;
  classList?: {
    contains: (className: string) => boolean;
  };
  dataset?: {
    k?: string;
  };
}

export interface LiveSourceState {
  kind: "camera" | "video" | "image" | null;
  running: boolean;
  paused: boolean;
  liveLabel: string;
}

export interface LiveRenderSettings {
  system: string;
  densityPct: number;
  smoothLabel: string;
  opacityPct: number;
  mirror: boolean;
  zoom: boolean;
  meshPts: boolean;
  bands: boolean;
}

export interface LiveAtlasPreviewState {
  active: boolean;
  source: string | null;
  validated: boolean | null;
  count: number | null;
}

export interface LiveIncisionOverlayState {
  loaded: boolean;
  qaLabel: string | null;
}

export interface LiveControllerSnapshot {
  schema_version: typeof LIVE_SNAPSHOT_SCHEMA_VERSION;
  reason: string;
  modelBadge: string;
  overlayMessage: string;
  source: LiveSourceState;
  render: LiveRenderSettings;
  atlasPreview: LiveAtlasPreviewState;
  atlasContract: RstlSourceContract | null;
  incisionOverlay: LiveIncisionOverlayState;
  recording: boolean;
  updatedAt: string;
}

export interface LiveSnapshotInput {
  reason?: string;
  modelBadge?: string;
  overlayMessage?: string;
  sourceKind?: LiveSourceState["kind"];
  sourceRunning?: boolean;
  sourcePaused?: boolean;
  liveLabel?: string;
  renderSystem?: string;
  densityFrac?: number;
  smoothLabel?: string;
  opacity?: number;
  mirror?: boolean;
  zoom?: boolean;
  meshPts?: boolean;
  bands?: boolean;
  previewSystem?: string | null;
  previewMeta?: {
    source?: string | null;
    validated?: boolean | null;
    count?: number | null;
  } | null;
  atlasContract?: RstlSourceContract | null;
  incisionOverlayLoaded?: boolean;
  incisionOverlayQaLabel?: string | null;
  recording?: boolean;
  updatedAt?: string;
}

export function liveTextOf(el?: LiveTextLike | null) {
  return el?.textContent?.trim?.() || "";
}

export function visibleLiveTextOf(el?: LiveTextLike | null) {
  if (!el || el.classList?.contains("hidden")) return "";
  return liveTextOf(el);
}

function pctFromFraction(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function buildLiveControllerSnapshot({
  reason = "state_update",
  modelBadge = "",
  overlayMessage = "",
  sourceKind = null,
  sourceRunning = false,
  sourcePaused = false,
  liveLabel = "待机",
  renderSystem = "",
  densityFrac = 0,
  smoothLabel = "",
  opacity = 0,
  mirror = false,
  zoom = false,
  meshPts = false,
  bands = false,
  previewSystem = null,
  previewMeta = null,
  atlasContract = null,
  incisionOverlayLoaded = false,
  incisionOverlayQaLabel = null,
  recording = false,
  updatedAt = new Date().toISOString(),
}: LiveSnapshotInput): LiveControllerSnapshot {
  return {
    schema_version: LIVE_SNAPSHOT_SCHEMA_VERSION,
    reason,
    modelBadge,
    overlayMessage,
    source: {
      kind: sourceKind,
      running: Boolean(sourceRunning),
      paused: Boolean(sourcePaused),
      liveLabel: liveLabel || "待机",
    },
    render: {
      system: renderSystem,
      densityPct: pctFromFraction(densityFrac),
      smoothLabel,
      opacityPct: pctFromFraction(opacity),
      mirror: Boolean(mirror),
      zoom: Boolean(zoom),
      meshPts: Boolean(meshPts),
      bands: Boolean(bands),
    },
    atlasPreview: {
      active: Boolean(previewSystem && previewMeta && renderSystem === previewSystem),
      source: previewMeta?.source || null,
      validated: previewMeta ? previewMeta.validated === true : null,
      count: Number.isFinite(previewMeta?.count) ? Number(previewMeta?.count) : null,
    },
    atlasContract,
    incisionOverlay: {
      loaded: Boolean(incisionOverlayLoaded),
      qaLabel: incisionOverlayQaLabel || null,
    },
    recording: Boolean(recording),
    updatedAt,
  };
}
