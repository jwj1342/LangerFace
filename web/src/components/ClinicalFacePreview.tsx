export interface ClinicalFacePreviewProps {
  large?: boolean;
  showZones?: boolean;
}

export function ClinicalFacePreview({ large = false, showZones = false }: ClinicalFacePreviewProps) {
  return (
    <div className={`case-face-preview${large ? " case-face-preview-large" : ""}`} aria-hidden="true">
      <span className="case-face-scan-glow" />
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
      <span className="case-face-rstl case-face-rstl-a" />
      <span className="case-face-rstl case-face-rstl-b" />
      <span className="case-face-rstl case-face-rstl-c" />
      <span className="case-face-rstl case-face-rstl-d" />
      <span className="case-face-lesion" />
      <span className="case-face-incision" />
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
