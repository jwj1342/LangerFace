type DynamicRecord = Record<string, any>;

function metricSummary(raw: DynamicRecord = {}) {
  const numberOrNull = (key: string) => {
    if (raw[key] == null) return null;
    const value = Number(raw[key]);
    return Number.isFinite(value) ? value : null;
  };
  return {
    precision: numberOrNull("precision"),
    recall: numberOrNull("recall"),
    iou: numberOrNull("iou"),
  };
}

export function buildLocalIncisionPrivacyAudit(secondaryCuesPresent: boolean) {
  return {
    raw_image_sent: false,
    raw_video_sent: false,
    local_workflow_fields: [
      "tumor.kind",
      "tumor.center",
      "tumor.diameter_mm",
      "tumor.depth_mm",
      "tumor.margin_mm",
      "tumor.boundary",
      "abstract face coordinates",
      "candidate geometry",
      "tool trace",
    ],
    browser_workflow_only: true,
    secondary_cues_present: secondaryCuesPresent,
  };
}

export function normalizeSecondaryCuePayload(payload: DynamicRecord = {}) {
  const metrics = payload.metrics || payload;
  return {
    schema_version: "secondary-cue-summary/v0.1",
    source: payload.source || metrics.source || "synthetic",
    source_tool: payload.source_tool || metrics.source_tool || "tools/prototype_wrinkle_lesion_cues.py",
    imported_at: new Date().toISOString(),
    confidence_label: metrics.confidence_label || "low_confidence_cv_cue_requires_manual_confirmation",
    manual_confirmation_required: true,
    used_for_geometry: false,
    clinical_boundary: "辅助线索 / 低置信度 / 需医生确认；不自动改变肿物边界或候选切口。",
    lesion: metricSummary(metrics.lesion || {}),
    wrinkle: metricSummary(metrics.wrinkle || {}),
    outputs: metrics.outputs || {},
    counts: {
      lesion_polylines: Array.isArray(payload.lesion_polylines) ? payload.lesion_polylines.length : null,
      wrinkle_polylines: Array.isArray(payload.wrinkle_polylines) ? payload.wrinkle_polylines.length : null,
    },
  };
}
