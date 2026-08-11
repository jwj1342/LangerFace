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
