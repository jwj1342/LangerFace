import {
  CONTROLLED_MARKER_DETECTOR_VERSION as CURRENT_DETECTOR_VERSION,
  detectControlledMarker as detectWithCurrentCore,
  translateControlledMarkerDetection,
  type ControlledMarkerDetection,
  type ControlledMarkerOptions,
  type MarkerImageData,
  type MarkerPoint,
} from "./controlledMarkerDetection.ts";
import {
  CONTROLLED_MARKER_DETECTOR_VERSION as LEGACY_DETECTOR_VERSION,
  detectControlledMarker as detectWithLegacyCore,
} from "./controlledMarkerDetectionLegacyV023.ts";

export type {
  ControlledMarkerDetection,
  ControlledMarkerOptions,
  MarkerImageData,
  MarkerPoint,
} from "./controlledMarkerDetection.ts";
export { translateControlledMarkerDetection };

export type ControlledMarkerDetectorProfile = "current-v0.34" | "legacy-v0.23";

export const LEGACY_CONTROLLED_MARKER_SOURCE_COMMIT = "fe703e2bb37d837f339f2b4fb9861d202568b8e6";
export const DEFAULT_CONTROLLED_MARKER_DETECTOR_PROFILE: ControlledMarkerDetectorProfile = "legacy-v0.23";

export function resolveControlledMarkerDetectorProfile(value?: string | null): ControlledMarkerDetectorProfile {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return DEFAULT_CONTROLLED_MARKER_DETECTOR_PROFILE;
  if (normalized === "current" || normalized === "current-v0.34" || normalized === "v0.34") {
    return "current-v0.34";
  }
  if (normalized === "legacy" || normalized === "legacy-v0.23" || normalized === "v0.23") {
    return "legacy-v0.23";
  }
  throw new Error(`Unsupported controlled marker detector profile: ${value}`);
}

const viteEnvironment = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;
const nodeEnvironment = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;
const controlledMarkerDiagnosticsEnabled = (
  viteEnvironment?.VITE_CONTROLLED_MARKER_DETECTOR_DIAGNOSTICS
    ?? nodeEnvironment?.VITE_CONTROLLED_MARKER_DETECTOR_DIAGNOSTICS
) === "1";

export const CONTROLLED_MARKER_DETECTOR_PROFILE = resolveControlledMarkerDetectorProfile(
  viteEnvironment?.VITE_CONTROLLED_MARKER_DETECTOR_PROFILE
    ?? nodeEnvironment?.VITE_CONTROLLED_MARKER_DETECTOR_PROFILE,
);

export function detectorVersionForProfile(profile: ControlledMarkerDetectorProfile): string {
  return profile === "legacy-v0.23" ? LEGACY_DETECTOR_VERSION : CURRENT_DETECTOR_VERSION;
}

export const CONTROLLED_MARKER_DETECTOR_VERSION = detectorVersionForProfile(
  CONTROLLED_MARKER_DETECTOR_PROFILE,
);

export function detectControlledMarkerWithProfile(
  profile: ControlledMarkerDetectorProfile,
  image: MarkerImageData,
  seed: MarkerPoint,
  options: ControlledMarkerOptions = {},
): ControlledMarkerDetection {
  const result = profile === "legacy-v0.23"
    ? detectWithLegacyCore(image, seed, options) as unknown as ControlledMarkerDetection
    : detectWithCurrentCore(image, seed, options);
  if (controlledMarkerDiagnosticsEnabled) {
    console.info(`[LangerFace] controlled marker profile result ${JSON.stringify({
      profile,
      version: detectorVersionForProfile(profile),
      seed,
      options,
      result,
    })}`);
  }
  return result;
}

export function detectControlledMarker(
  image: MarkerImageData,
  seed: MarkerPoint,
  options: ControlledMarkerOptions = {},
): ControlledMarkerDetection {
  return detectControlledMarkerWithProfile(
    CONTROLLED_MARKER_DETECTOR_PROFILE,
    image,
    seed,
    options,
  );
}
