import type { IncisionOverlayPayload } from "./data_source.js";
import type { Triangle, Vec3 } from "./soft_body.js";

export function validateIncisionOverlay(overlay: unknown): overlay is IncisionOverlayPayload;

export function compileIncisionOverlay(
  record: Record<string, any>,
  verts: Vec3[],
  tris: Triangle[],
): IncisionOverlayPayload | null;
