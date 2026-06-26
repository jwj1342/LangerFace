export const LIVE_SNAPSHOT_SCHEMA_VERSION = "react-live-controller-snapshot/v0.1";

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

export interface LiveRouteState {
  route: "2d" | "3d" | string;
  mode3d: string;
  hint: string;
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

export interface LiveReconState {
  has3dModel: boolean;
  projectable: boolean;
  scanActive: boolean;
  twinMode: string;
  twinTexture: boolean;
  status: string;
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
  route: LiveRouteState;
  render: LiveRenderSettings;
  recon: LiveReconState;
  atlasPreview: LiveAtlasPreviewState;
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
  route?: string;
  mode3d?: string;
  routeHint?: string;
  renderSystem?: string;
  densityFrac?: number;
  smoothLabel?: string;
  opacity?: number;
  mirror?: boolean;
  zoom?: boolean;
  meshPts?: boolean;
  bands?: boolean;
  has3dModel?: boolean;
  projectable?: boolean;
  scanActive?: boolean;
  twinMode?: string;
  twinTexture?: boolean;
  reconStatus?: string;
  previewSystem?: string | null;
  previewMeta?: {
    source?: string | null;
    validated?: boolean | null;
    count?: number | null;
  } | null;
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
  route = "2d",
  mode3d = "",
  routeHint = "",
  renderSystem = "",
  densityFrac = 0,
  smoothLabel = "",
  opacity = 0,
  mirror = false,
  zoom = false,
  meshPts = false,
  bands = false,
  has3dModel = false,
  projectable = false,
  scanActive = false,
  twinMode = "",
  twinTexture = false,
  reconStatus = "",
  previewSystem = null,
  previewMeta = null,
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
    route: {
      route,
      mode3d,
      hint: routeHint,
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
    recon: {
      has3dModel: Boolean(has3dModel),
      projectable: Boolean(projectable),
      scanActive: Boolean(scanActive),
      twinMode,
      twinTexture: Boolean(twinTexture),
      status: reconStatus,
    },
    atlasPreview: {
      active: Boolean(previewSystem && previewMeta && renderSystem === previewSystem),
      source: previewMeta?.source || null,
      validated: previewMeta ? previewMeta.validated === true : null,
      count: Number.isFinite(previewMeta?.count) ? Number(previewMeta?.count) : null,
    },
    incisionOverlay: {
      loaded: Boolean(incisionOverlayLoaded),
      qaLabel: incisionOverlayQaLabel || null,
    },
    recording: Boolean(recording),
    updatedAt,
  };
}
