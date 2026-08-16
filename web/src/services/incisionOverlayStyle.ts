import { standardRstlStrokeWidth } from "./rstlRenderPlan.ts";

export type IncisionOverlayCandidateType = "linear" | "fusiform" | string;

export interface IncisionOverlayStyle {
  rstlLineWidth: number;
  candidate: {
    color: string;
    lineWidth: number;
    haloColor: string;
    haloWidth: number;
  };
  boundary: {
    color: string;
    lineWidth: number;
    haloColor: string;
    haloWidth: number;
  };
  endpointRadius: number;
}

export interface IncisionOverlayStyleOptions {
  /** Final CSS pixels produced by one source-image pixel after contain-fit and zoom. */
  displayScale?: number;
}

export function incisionCandidateScreenStyle(candidateType: IncisionOverlayCandidateType = "fusiform") {
  const linear = candidateType === "linear";
  return {
    // Opaque matte cobalt separates the incision from both warm skin and the
    // magenta RSTL layer without using a luminous glow or a toy-like halo.
    color: linear ? "#166534" : "#003b73",
    lineWidth: 1,
    haloColor: linear ? "rgba(3, 7, 18, 0.82)" : "#003b73",
    haloWidth: linear ? 1.5 : 1,
  };
}

export function visibleCandidateSourceWidth(
  nominalSourceWidth: number,
  rstlSourceWidth: number,
  displayScale?: number,
): number {
  if (!(displayScale && Number.isFinite(displayScale) && displayScale > 0)) return nominalSourceWidth;
  // Below one CSS pixel, browser antialiasing necessarily represents the
  // stroke as partial pixel coverage. Keep a bounded visibility floor while
  // retaining a clearly thinner appearance than the shared RSTL layer.
  const visibilityFloor = 1 / displayScale;
  return Math.min(rstlSourceWidth * 0.5, Math.max(nominalSourceWidth, visibilityFloor));
}

export function incisionOverlayStyle(
  canvasWidth: number,
  candidateType: IncisionOverlayCandidateType = "fusiform",
  options: IncisionOverlayStyleOptions = {},
): IncisionOverlayStyle {
  const rstlLineWidth = standardRstlStrokeWidth(canvasWidth);
  const nominalCandidateLineWidth = Math.max(0.3, rstlLineWidth / 6);
  const candidateLineWidth = candidateType === "fusiform"
    ? visibleCandidateSourceWidth(nominalCandidateLineWidth, rstlLineWidth, options.displayScale)
    : nominalCandidateLineWidth;
  const boundaryLineWidth = Math.max(0.75, rstlLineWidth * 0.45);
  return {
    rstlLineWidth,
    candidate: {
      color: candidateType === "linear" ? "#166534" : "#003b73",
      lineWidth: candidateLineWidth,
      haloColor: candidateType === "linear" ? "rgba(3, 7, 18, 0.9)" : "#003b73",
      haloWidth: candidateType === "linear"
        ? candidateLineWidth + Math.max(0.12, candidateLineWidth * 0.25)
        : candidateLineWidth,
    },
    boundary: {
      color: "#facc15",
      lineWidth: boundaryLineWidth,
      haloColor: "rgba(3, 7, 18, 0.88)",
      haloWidth: boundaryLineWidth + Math.max(0.5, boundaryLineWidth * 0.5),
    },
    endpointRadius: 3,
  };
}
