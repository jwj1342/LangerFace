import { standardRstlStrokeWidth } from "./rstlRenderPlan.ts";

export type IncisionOverlayCandidateType = "linear" | "fusiform" | string;

const FUSIFORM_HIGHLIGHT_COLOR = "#67e8f9";
const FUSIFORM_COMPACT_HALO_COLOR = "#082f49";
const LINEAR_HIGHLIGHT_COLOR = "#4ade80";
const SHARED_ANNOTATION_LINE_WIDTH = 0.95;

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
  incisionCenter: {
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
  /** Compatibility input; annotation paint is identical across device layouts. */
  compact?: boolean;
  /** Photo-only view zoom. Camera/video stay at 1. */
  viewScale?: number;
  /** Full source-photo width after fit, focus crop and zoom, in CSS pixels. */
  photoWidthCss?: number;
  /** Short side of the displayed lesion bounds; no screen-pixel minimum. */
  lesionExtentCss?: number;
}

function boundedOverlayViewScale(viewScale?: number): number {
  const value = Number(viewScale);
  if (!Number.isFinite(value) || value <= 1) return 1;
  return Math.min(value, 1.25);
}

/**
 * Final screen-space tokens shared by the workflow photo SVG and live canvas.
 * Stroke tokens are independent of device layout. Photo centers follow the
 * projected photo width and lesion extent; live centers use shared defaults.
 */
export function incisionOverlayScreenStyle(
  candidateType: IncisionOverlayCandidateType = "fusiform",
  options: IncisionOverlayScreenStyleOptions = {},
): Omit<IncisionOverlayStyle, "rstlLineWidth"> {
  if (Number.isFinite(options.photoWidthCss) && options.photoWidthCss! > 0) {
    const base = incisionOverlayScreenStyle(candidateType);
    const scale = options.photoWidthCss! / 650;
    const extent = Number.isFinite(options.lesionExtentCss) && options.lesionExtentCss! > 0
      ? options.lesionExtentCss! : Infinity;
    const fixedBoundaryWidth = SHARED_ANNOTATION_LINE_WIDTH;
    // Photo paths are already in CSS pixels. Keep both the yellow boundary
    // and the confirmable incision line in screen space so image zoom cannot
    // make either line visually thicker.
    return {
      ...base,
      candidate: {
        ...base.candidate,
        lineWidth: fixedBoundaryWidth,
        haloWidth: candidateType === "linear" ? fixedBoundaryWidth + 0.5 : fixedBoundaryWidth,
      },
      boundary: {
        ...base.boundary,
        lineWidth: fixedBoundaryWidth,
        haloWidth: fixedBoundaryWidth + 0.5,
      },
      center: {
        ...base.center,
        radiusCss: Math.min(0.8 * scale, 0.08 * extent),
        strokeWidthCss: Math.min(0.5 * scale, 0.025 * extent),
      },
      incisionCenter: {
        ...base.incisionCenter,
        radiusCss: Math.min(1.5 * scale, 0.12 * extent),
        strokeWidthCss: Math.min(0.5 * scale, 0.025 * extent),
      },
      endpointRadius: Math.min(1.5 * scale, 0.12 * extent),
    };
  }
  const viewScale = boundedOverlayViewScale(options.viewScale);
  const linear = candidateType === "linear";
  const candidateLineWidth = SHARED_ANNOTATION_LINE_WIDTH;
  const boundaryLineWidth = SHARED_ANNOTATION_LINE_WIDTH;
  return {
    candidate: {
      color: linear ? LINEAR_HIGHLIGHT_COLOR : FUSIFORM_HIGHLIGHT_COLOR,
      lineWidth: candidateLineWidth,
      haloColor: linear
        ? "rgba(3, 7, 18, 0.9)"
        : FUSIFORM_COMPACT_HALO_COLOR,
      haloWidth: linear
        ? candidateLineWidth + 0.5
        : candidateLineWidth,
    },
    boundary: {
      color: "#fde047",
      lineWidth: boundaryLineWidth,
      haloColor: "rgba(3, 7, 18, 0.88)",
      haloWidth: boundaryLineWidth + 0.5,
    },
    center: {
      color: "transparent",
      strokeColor: "#ffffff",
      radiusCss: 2,
      strokeWidthCss: 1,
    },
    incisionCenter: {
      color: "#f43f5e",
      strokeColor: "#0b1118",
      radiusCss: 6,
      strokeWidthCss: 1,
    },
    endpointRadius: 3 * viewScale,
  };
}

export function incisionCandidateScreenStyle(candidateType: IncisionOverlayCandidateType = "fusiform") {
  const linear = candidateType === "linear";
  return {
    // Keep the established one-pixel desktop width while sharing the bright
    // cyan fusiform hue used by the compact workflow.
    color: linear ? LINEAR_HIGHLIGHT_COLOR : FUSIFORM_HIGHLIGHT_COLOR,
    lineWidth: 1,
    haloColor: linear ? "rgba(3, 7, 18, 0.82)" : FUSIFORM_HIGHLIGHT_COLOR,
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
      haloColor: candidateType === "linear" ? screenStyle.candidate.haloColor : FUSIFORM_HIGHLIGHT_COLOR,
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
      ...screenStyle.center,
    },
    incisionCenter: {
      ...screenStyle.incisionCenter,
    },
    endpointRadius: 3,
  };
}
