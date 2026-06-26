import type { IncisionOverlayPayload } from "./data_source.js";

export function validateIncisionOverlay(overlay: unknown): overlay is IncisionOverlayPayload;
