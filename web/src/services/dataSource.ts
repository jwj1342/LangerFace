// Browser data source boundary for transient cross-workbench payloads.
// The current implementation is local-only; callers should depend on the
// BrowserDataSource contract so a remote source can replace it later.

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

export interface BrowserDataSource {
  stagePreviewAtlas(atlas: PreviewAtlasPayload): boolean;
  takePreviewAtlas(): PreviewAtlasPayload | null;
  stageIncisionOverlay(overlay: IncisionOverlayPayload): boolean;
  loadIncisionOverlay(): IncisionOverlayPayload | null;
  clearIncisionOverlay(): void;
}

const PREVIEW_ATLAS_KEY = "langerface.previewAtlas";
const INCISION_OVERLAY_KEY = "langerface.incisionOverlay";

function hasSessionStorage(): boolean {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage !== null;
  } catch {
    return false;
  }
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

export const LocalDataSource: BrowserDataSource = {
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
