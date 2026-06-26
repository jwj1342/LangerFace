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

export const LocalDataSource: BrowserDataSource;
export const dataSource: BrowserDataSource;
