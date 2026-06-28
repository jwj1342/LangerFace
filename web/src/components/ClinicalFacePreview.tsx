import type { CSSProperties } from "react";

export type ClinicalFacePreviewMode = "2d" | "3d" | "live";
export type ClinicalFaceRstlDensity = "low" | "standard" | "high";

export interface ClinicalFacePreviewLayers {
  rstl: boolean;
  rstlDensity: ClinicalFaceRstlDensity;
  rstlOpacity: number;
  personalizedWrinkles: boolean;
  wrinkleOpacity: number;
  blendedField: boolean;
  incisionDesign: boolean;
}

export interface ClinicalFacePreviewProps {
  large?: boolean;
  layers?: Partial<ClinicalFacePreviewLayers>;
  mode?: ClinicalFacePreviewMode;
  showZones?: boolean;
}

const DEFAULT_LAYERS: ClinicalFacePreviewLayers = {
  rstl: true,
  rstlDensity: "standard",
  rstlOpacity: 0.72,
  personalizedWrinkles: true,
  wrinkleOpacity: 0.68,
  blendedField: false,
  incisionDesign: true,
};

function clampOpacity(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0.2, Math.min(1, value));
}

function rstlLineKeys(density: ClinicalFaceRstlDensity) {
  if (density === "low") return ["a", "c"];
  if (density === "high") return ["a", "b", "c", "d", "e", "f"];
  return ["a", "b", "c", "d"];
}

export function ClinicalFacePreview({
  large = false,
  layers,
  mode = "2d",
  showZones = false,
}: ClinicalFacePreviewProps) {
  const resolvedLayers: ClinicalFacePreviewLayers = {
    ...DEFAULT_LAYERS,
    ...layers,
    rstlOpacity: clampOpacity(layers?.rstlOpacity, DEFAULT_LAYERS.rstlOpacity),
    wrinkleOpacity: clampOpacity(layers?.wrinkleOpacity, DEFAULT_LAYERS.wrinkleOpacity),
  };
  const rstlOpacity = resolvedLayers.rstl ? resolvedLayers.rstlOpacity : 0;
  const wrinkleOpacity = resolvedLayers.personalizedWrinkles ? resolvedLayers.wrinkleOpacity : 0;
  const style = {
    "--case-rstl-opacity": rstlOpacity.toString(),
    "--case-wrinkle-opacity": wrinkleOpacity.toString(),
  } as CSSProperties;
  const classes = [
    "case-face-preview",
    large ? "case-face-preview-large" : "",
    `case-face-mode-${mode}`,
    `case-face-density-${resolvedLayers.rstlDensity}`,
    resolvedLayers.blendedField ? "case-face-has-blended-field" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={classes} style={style} aria-hidden="true">
      <span className="case-face-scan-glow" />
      {resolvedLayers.blendedField ? <span className="case-face-blended-field" /> : null}
      <span className="case-face-outline" />
      <span className="case-face-depth case-face-depth-left" />
      <span className="case-face-depth case-face-depth-right" />
      <span className="case-face-midline" />
      <span className="case-face-crosshair case-face-crosshair-h" />
      <span className="case-face-crosshair case-face-crosshair-v" />
      <span className="case-face-eye case-face-eye-left" />
      <span className="case-face-eye case-face-eye-right" />
      <span className="case-face-nose" />
      <span className="case-face-mouth" />
      <span className="case-face-cheek case-face-cheek-left" />
      <span className="case-face-cheek case-face-cheek-right" />
      {resolvedLayers.personalizedWrinkles ? (
        <>
          <span className="case-face-wrinkle case-face-wrinkle-forehead" />
          <span className="case-face-wrinkle case-face-wrinkle-crows-left" />
          <span className="case-face-wrinkle case-face-wrinkle-crows-right" />
          <span className="case-face-wrinkle case-face-wrinkle-nasolabial-left" />
          <span className="case-face-wrinkle case-face-wrinkle-nasolabial-right" />
          <span className="case-face-wrinkle case-face-wrinkle-chin" />
        </>
      ) : null}
      {resolvedLayers.rstl ? rstlLineKeys(resolvedLayers.rstlDensity).map((key) => (
        <span key={key} className={`case-face-rstl case-face-rstl-${key}`} />
      )) : null}
      <span className="case-face-lesion" />
      {resolvedLayers.incisionDesign ? <span className="case-face-incision" /> : null}
      {showZones ? (
        <>
          <span className="case-face-zone case-face-zone-eye" />
          <span className="case-face-zone case-face-zone-mouth" />
        </>
      ) : null}
      <span className="case-face-ruler"><b>10 mm</b></span>
      <span className="case-face-coordinate">R12 / Z05</span>
    </div>
  );
}
