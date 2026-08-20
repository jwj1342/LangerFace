import { compareCandidateRecords } from "./incisionTools.ts";
import type { TumorInput } from "./incisionCandidateTools.ts";

type DynamicRecord = Record<string, any>;

export interface ReviewExportInput {
  current: DynamicRecord | null;
  saved: DynamicRecord[];
  secondaryCues: DynamicRecord;
  exportedAt?: string;
}

export interface TumorExportInput {
  tumor: TumorInput;
  tumorQuality: DynamicRecord;
  boundarySummary: DynamicRecord;
  exportedAt?: string;
}

export function buildReviewExportPayload({
  current,
  saved,
  secondaryCues,
  exportedAt = new Date().toISOString(),
}: ReviewExportInput): DynamicRecord {
  const records = [current, ...saved].filter(Boolean) as DynamicRecord[];
  return {
    schema_version: "incision-review-export/v0.4",
    exported_at: exportedAt,
    current,
    saved,
    secondary_cues: secondaryCues,
    candidate_comparison: compareCandidateRecords(records),
  };
}

export function buildTumorExportPayload({
  tumor,
  tumorQuality,
  boundarySummary,
  exportedAt = new Date().toISOString(),
}: TumorExportInput): DynamicRecord {
  return {
    schema_version: "tumor-input/v0.2",
    exported_at: exportedAt,
    tumor,
    tumor_quality: tumorQuality,
    boundary_summary: boundarySummary,
    privacy_audit: {
      raw_image_sent: false,
      raw_video_sent: false,
      contains_face_image: false,
      contains_abstract_face_coordinates: true,
    },
  };
}

export function downloadText(
  filename: string,
  text: string,
  type = "application/json",
): void {
  const blob = new Blob([text], { type });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  });
}

interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function svgOverlayExportViewBox(canvasRect: RectLike, overlayRect: RectLike) {
  if (!(canvasRect.width > 0) || !(canvasRect.height > 0)) return null;
  return {
    x: canvasRect.left - overlayRect.left,
    y: canvasRect.top - overlayRect.top,
    width: canvasRect.width,
    height: canvasRect.height,
  };
}

function inlineSvgPresentation(source: SVGSVGElement, clone: SVGSVGElement) {
  const properties = [
    "display", "fill", "fill-opacity", "stroke", "stroke-opacity", "stroke-width",
    "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "font-family", "font-size",
    "font-weight", "paint-order",
  ];
  const sourceElements = [source, ...source.querySelectorAll<SVGElement>("*")];
  const cloneElements = [clone, ...clone.querySelectorAll<SVGElement>("*")];
  sourceElements.forEach((element, index) => {
    const target = cloneElements[index];
    if (!target) return;
    const computed = getComputedStyle(element);
    const declarations = properties
      .map((property) => `${property}:${computed.getPropertyValue(property)}`)
      .join(";");
    target.setAttribute("style", declarations);
  });
}

function svgImage(source: SVGSVGElement, viewBox: NonNullable<ReturnType<typeof svgOverlayExportViewBox>>) {
  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(Math.max(1, Math.round(viewBox.width))));
  clone.setAttribute("height", String(Math.max(1, Math.round(viewBox.height))));
  clone.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
  clone.setAttribute("preserveAspectRatio", "none");
  clone.style.display = "block";
  inlineSvgPresentation(source, clone);
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("workflow SVG overlay could not be rendered")); };
    image.src = url;
  });
}

export async function downloadCanvasWithSvgOverlayPng(
  canvas: HTMLCanvasElement,
  overlay: SVGSVGElement,
  filename: string,
): Promise<void> {
  const viewBox = svgOverlayExportViewBox(canvas.getBoundingClientRect(), overlay.getBoundingClientRect());
  const hasVisibleOverlay = getComputedStyle(overlay).display !== "none"
    && [...overlay.querySelectorAll<SVGGraphicsElement>("path, circle, text")]
      .some((element) => getComputedStyle(element).display !== "none"
        && (element.tagName !== "path" || Boolean(element.getAttribute("d"))));
  if (!viewBox || !hasVisibleOverlay) {
    downloadCanvasPng(canvas, filename);
    return;
  }
  try {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const context = exportCanvas.getContext("2d");
    if (!context) throw new Error("2d canvas context is required for workflow export");
    if (canvas.classList.contains("mirror")) {
      context.translate(exportCanvas.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);
    context.setTransform(1, 0, 0, 1, 0, 0);
    const overlayImage = await svgImage(overlay, viewBox);
    context.drawImage(overlayImage, 0, 0, exportCanvas.width, exportCanvas.height);
    downloadCanvasPng(exportCanvas, filename);
  } catch {
    downloadCanvasPng(canvas, filename);
  }
}
