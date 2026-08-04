export type AnnotationExportKind = "atlas" | "xyz";

export interface AnnotationExportSource {
  system: string;
  toAtlasJSON(): unknown;
  toXyzJSON(): unknown;
}

export interface AnnotationExportArtifact {
  filename: string;
  mimeType: "application/json";
  text: string;
}

export function buildAnnotationExport(
  source: AnnotationExportSource,
  kind: AnnotationExportKind,
): AnnotationExportArtifact {
  const payload = kind === "atlas" ? source.toAtlasJSON() : source.toXyzJSON();
  return {
    filename: kind === "atlas"
      ? `atlas_${source.system}_annotated.json`
      : `lines_${source.system}_xyz.json`,
    mimeType: "application/json",
    text: JSON.stringify(payload, null, 2),
  };
}

export function downloadAnnotationExport(artifact: AnnotationExportArtifact): void {
  const blob = new Blob([artifact.text], { type: artifact.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
