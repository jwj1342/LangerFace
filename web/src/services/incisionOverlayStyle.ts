import { standardRstlStrokeWidth } from "./rstlRenderPlan.ts";

export type IncisionOverlayCandidateType = "linear" | "fusiform" | string;

const FUSIFORM_HIGHLIGHT_COLOR = "#67e8f9";
const FUSIFORM_COMPACT_HALO_COLOR = "#082f49";
const LINEAR_HIGHLIGHT_COLOR = "#4ade80";

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
  /** Phone workflow keeps its compact stroke sizing. */
  compact?: boolean;
  /** Photo-only view zoom. Camera/video stay at 1. */
  viewScale?: number;
  /** Full source-photo width after fit, focus crop and zoom, in CSS pixels. */
  photoWidthCss?: number;
  /** Short side of the displayed lesion bounds; no screen-pixel minimum. */
  lesionExtentCss?: number;
}

function boundedOverlayViewScale(viewScale?: number, compact = false): number {
  const value = Number(viewScale);
  if (!Number.isFinite(value) || value <= 1) return 1;
  return Math.min(value, compact ? 1.5 : 1.25);
}

/**
 * Final screen-space tokens shared by the workflow photo SVG and live canvas.
 * Photo paint follows the projected photo width and lesion extent. Without
 * photo dimensions, live-canvas defaults retain their established appearance.
 */
export function incisionOverlayScreenStyle(
  candidateType: IncisionOverlayCandidateType = "fusiform",
  options: IncisionOverlayScreenStyleOptions = {},
): Omit<IncisionOverlayStyle, "rstlLineWidth"> {
  if (Number.isFinite(options.photoWidthCss) && options.photoWidthCss! > 0) {
    const base = incisionOverlayScreenStyle(candidateType, { compact: options.compact });
    const scale = options.photoWidthCss! / 650;
    const extent = Number.isFinite(options.lesionExtentCss) && options.lesionExtentCss! > 0
      ? options.lesionExtentCss! : Infinity;
    const candidateWidth = Math.min(0.5 * scale, 0.06 * extent);
    const fixedBoundaryWidth = options.compact ? 0.95 : 1.33;
    // Photo paths are already in CSS pixels. Keep the yellow boundary in
    // screen space so image zoom cannot make it visually thicker.
    return {
      ...base,
      candidate: {
        ...base.candidate,
        lineWidth: candidateWidth,
        haloWidth: candidateType === "linear" ? Math.min(0.75 * scale, 0.09 * extent) : candidateWidth,
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
  const compact = options.compact === true;
  const viewScale = boundedOverlayViewScale(options.viewScale, compact);
  // The photo SVG is already in screen coordinates. Do not enlarge its strokes
  // again when the image zooms. Small phone centers follow photo zoom instead
  // of staying as a 12px dot that can cover an entire zoomed-out lesion.
  const candidateViewScale = compact ? 1 : viewScale;
  const photoZoom = Number(options.viewScale);
  const phoneCenterScale = Math.min(5, Number.isFinite(photoZoom) && photoZoom > 0 ? photoZoom : 1) / 5;
  const centerScale = compact ? Math.min(viewScale, 4 / 3) : viewScale;
  const linear = candidateType === "linear";
  const candidateLineWidth = (compact ? 0.8 : 1) * candidateViewScale;
  const boundaryLineWidth = compact ? 0.95 : 1.33;
  return {
    candidate: {
      color: linear ? LINEAR_HIGHLIGHT_COLOR : FUSIFORM_HIGHLIGHT_COLOR,
      lineWidth: candidateLineWidth,
      haloColor: linear
        ? "rgba(3, 7, 18, 0.9)"
        : compact ? FUSIFORM_COMPACT_HALO_COLOR : FUSIFORM_HIGHLIGHT_COLOR,
      haloWidth: linear
        ? candidateLineWidth + (compact ? 0.6 * candidateViewScale : 0.5 * viewScale)
        : candidateLineWidth,
    },
    boundary: {
      color: compact ? "#fde047" : "#facc15",
      lineWidth: boundaryLineWidth,
      haloColor: "rgba(3, 7, 18, 0.88)",
      haloWidth: boundaryLineWidth + 0.5,
    },
    center: {
      color: "transparent",
      strokeColor: "#ffffff",
      radiusCss: compact ? 2 * phoneCenterScale : 2,
      strokeWidthCss: compact ? 0.5 : 1,
    },
    incisionCenter: {
      color: "#f43f5e",
      strokeColor: "#0b1118",
      radiusCss: compact ? 3 * phoneCenterScale : 6,
      strokeWidthCss: compact ? 0.5 : 1,
    },
    endpointRadius: compact ? 2.5 * centerScale : 3 * centerScale,
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
      ...screenStyle.center,
    },
    incisionCenter: {
      ...screenStyle.incisionCenter,
    },
    endpointRadius: 3,
  };
}
