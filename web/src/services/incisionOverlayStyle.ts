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
  center: {
    color: string;
    strokeColor: string;
    radiusCss: number;
    strokeWidthCss: number;
  };
  endpointRadius: number;
}

export interface IncisionOverlayStyleOptions {
  /** Final CSS pixels produced by one source-image pixel after contain-fit and zoom. */
  displayScale?: number;
}

export interface IncisionOverlayScreenStyleOptions {
  /** Phone workflow uses a deliberately lighter visual treatment. */
  compact?: boolean;
  /** Photo-only view zoom. Camera/video stay at 1. */
  viewScale?: number;
}

function boundedOverlayViewScale(viewScale?: number, compact = false): number {
  const value = Number(viewScale);
  if (!Number.isFinite(value) || value <= 1) return 1;
  return Math.min(value, compact ? 1.5 : 1.25);
}

/**
 * Final screen-space tokens shared by the workflow photo SVG and live canvas.
 * The compact baseline is intentionally finer at the full-photo view; zoom may
 * enlarge it modestly, but never inversely enlarge it while the photo shrinks.
 */
export function incisionOverlayScreenStyle(
  candidateType: IncisionOverlayCandidateType = "fusiform",
  options: IncisionOverlayScreenStyleOptions = {},
): Omit<IncisionOverlayStyle, "rstlLineWidth"> {
  const compact = options.compact === true;
  const viewScale = boundedOverlayViewScale(options.viewScale, compact);
  const centerScale = compact ? Math.min(viewScale, 4 / 3) : viewScale;
  const linear = candidateType === "linear";
  const candidateLineWidth = (compact ? 0.65 : 1) * viewScale;
  const boundaryLineWidth = (compact ? 0.7 : 2) * viewScale;
  return {
    candidate: {
      color: compact ? (linear ? "#4ade80" : "#67e8f9") : (linear ? "#166534" : "#003b73"),
      lineWidth: candidateLineWidth,
      haloColor: linear ? "rgba(3, 7, 18, 0.9)" : compact ? "#67e8f9" : "#003b73",
      haloWidth: linear
        ? candidateLineWidth + (compact ? 0.3 : 0.5) * viewScale
        : candidateLineWidth,
    },
    boundary: {
      color: compact ? "#fde047" : "#facc15",
      lineWidth: boundaryLineWidth,
      haloColor: "rgba(3, 7, 18, 0.88)",
      haloWidth: boundaryLineWidth + (compact ? 0.5 : 1) * viewScale,
    },
    center: {
      color: "#fb7185",
      strokeColor: "#fff1f2",
      radiusCss: (compact ? 3 : 6) * centerScale,
      strokeWidthCss: (compact ? 0.65 : 2) * centerScale,
    },
    endpointRadius: compact ? 2.5 * centerScale : 3 * centerScale,
  };
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

export function visibleBoundarySourceWidth(
  nominalSourceWidth: number,
  displayScale?: number,
): number {
  if (!(displayScale && Number.isFinite(displayScale) && displayScale > 0)) return nominalSourceWidth;
  return Math.max(nominalSourceWidth, 0.85 / displayScale);
}

export function incisionOverlayStyle(
  canvasWidth: number,
  candidateType: IncisionOverlayCandidateType = "fusiform",
  options: IncisionOverlayStyleOptions = {},
): IncisionOverlayStyle {
  const screenStyle = incisionOverlayScreenStyle(candidateType);
  const rstlLineWidth = standardRstlStrokeWidth(canvasWidth);
  const nominalCandidateLineWidth = Math.max(0.3, rstlLineWidth / 6);
  const candidateLineWidth = candidateType === "fusiform"
    ? visibleCandidateSourceWidth(nominalCandidateLineWidth, rstlLineWidth, options.displayScale)
    : nominalCandidateLineWidth;
  const boundaryLineWidth = visibleBoundarySourceWidth(
    Math.max(0.75, rstlLineWidth * 0.45),
    options.displayScale,
  );
  const boundaryHaloWidth = boundaryLineWidth + (options.displayScale
    ? 1 / options.displayScale
    : Math.max(0.5, boundaryLineWidth * 0.5));
  return {
    rstlLineWidth,
    candidate: {
      color: screenStyle.candidate.color,
      lineWidth: candidateLineWidth,
      haloColor: screenStyle.candidate.haloColor,
      haloWidth: candidateType === "linear"
        ? candidateLineWidth + Math.max(0.12, candidateLineWidth * 0.25)
        : candidateLineWidth,
    },
    boundary: {
      color: screenStyle.boundary.color,
      lineWidth: boundaryLineWidth,
      haloColor: screenStyle.boundary.haloColor,
      haloWidth: boundaryHaloWidth,
    },
    center: {
      color: "#fb7185",
      strokeColor: "#fff1f2",
      radiusCss: 4,
      strokeWidthCss: 0.8,
    },
    endpointRadius: 3,
  };
}
