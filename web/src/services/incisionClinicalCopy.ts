const TUMOR_KIND_LABELS: Record<string, string> = {
  subcutaneous: "皮下肿物",
  cutaneous: "皮表肿物",
};

const CANDIDATE_TYPE_LABELS: Record<string, string> = {
  linear: "线性切口",
  fusiform: "梭形切口",
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  pending_clinician_confirmation: "待医生确认",
  approved_for_discussion: "已确认研究候选",
  needs_revision: "退回修改",
  rejected_by_clinician: "医生已否决",
};

const REGION_LABELS: Record<string, string> = {
  cheek: "颊区",
  forehead: "额区",
  ear_region: "耳周区",
  temple_cheek: "颞颊交界",
  upper_eyelid: "上眼睑",
  inner_canthus: "内眦区",
  lower_eyelid: "下眼睑",
  nasal_dorsum: "鼻背",
  nasal_tip: "鼻尖",
  nasal_ala: "鼻翼",
  nasolabial_fold: "鼻唇沟",
  oral_commissure: "口角",
  upper_lip: "上唇",
  lip_vermilion: "唇红缘",
  chin: "颏区",
  jawline: "下颌缘",
};

const SUBUNIT_LABELS: Record<string, string> = {
  midface: "面中部",
  forehead: "额部",
  preauricular_or_postauricular: "耳前或耳后",
  lateral_face: "面部外侧",
  upper_eyelid: "上眼睑",
  medial_canthal_region: "内眦",
  free_margin: "游离缘",
  nasal_root_or_dorsum: "鼻根或鼻背",
  nasal_tip: "鼻尖",
  nose: "鼻部",
  midface_crease: "面中部皱襞",
  oral_commissure: "口角",
  white_lip: "白唇",
  oral_free_margin: "口周游离缘",
  chin: "颏部",
  mandibular_border: "下颌缘",
};

const REASON_LABELS: Record<string, string> = {
  bbox_heuristic_region_classifier: "基于标准脸分区估计",
  outside_canonical_face_bbox: "点位超出标准脸范围",
  near_canonical_face_edge: "靠近标准脸边缘",
  near_region_rule_boundary: "靠近分区边界",
  heuristic_region_low_confidence: "面部分区置信度较低",
  near_sensitive_free_margin: "靠近敏感游离缘",
  lateral_face_edge_bucket: "位于面部外侧边缘",
  lateral_face_transition: "位于颞颊过渡区",
  overlapping_sensitive_subunit: "敏感亚单位重叠",
  narrow_nasal_tip_band: "位于鼻尖狭窄区域",
  nasolabial_transition_band: "位于鼻唇沟过渡区",
  oral_commissure_transition_band: "位于口角过渡区",
  jawline_or_face_boundary: "位于下颌缘或面部边界",
  empty_atlas: "局部没有可用 RSTL 图谱",
  nearest_atlas_support_far: "距离最近 RSTL 支持线较远",
  high_angular_spread: "附近 RSTL 方向离散较大",
  browser_direction_variant_requires_clinician_review: "方向备选需医生复核",
};

const GUARDRAIL_LABELS: Record<string, string> = {
  boundary_center_shift: "肿物边界中心偏移较大",
  candidate_near_sensitive_free_margin: "候选切口靠近敏感游离缘",
  cutaneous_boundary_center_shift: "皮表边界中心偏移较大",
  cutaneous_boundary_degenerate_area: "皮表边界面积不足",
  cutaneous_boundary_self_intersection: "皮表边界存在自交",
  cutaneous_boundary_too_few_points: "皮表边界点不足",
  few_boundary_points: "边界点较少",
  fusiform_axis_coverage_deficit: "梭形切口长轴覆盖不足",
  fusiform_boundary_outside_envelope: "肿物边界超出梭形包络",
  fusiform_outline_not_smoothly_tapered: "梭形切口收尖不够平滑",
  fusiform_outline_self_intersection: "梭形切口轮廓存在自交",
  linear_diameter_coverage_deficit: "线性切口长度不足以覆盖肿物直径",
  low_region_confidence: "面部分区置信度较低",
  low_rstl_confidence: "RSTL 方向置信度较低",
  missing_cutaneous_boundary: "缺少皮表肿物边界",
  missing_cutaneous_margin: "缺少皮表安全切缘",
  missing_subcutaneous_depth: "缺少皮下肿物深度",
  missing_tumor_author: "缺少记录者",
  near_sensitive_free_margin: "病灶靠近敏感游离缘",
  non_mm_tumor_units: "肿物单位不是毫米",
  rstl_deviation_override: "候选方向偏离局部 RSTL",
  sensitive_region_lower_eyelid: "下眼睑属于敏感区域",
  sensitive_region_lip_vermilion: "唇红缘属于敏感区域",
  sensitive_region_nasal_ala: "鼻翼属于敏感区域",
  sensitive_region_nasal_tip: "鼻尖属于敏感区域",
  sensitive_region_oral_commissure: "口角属于敏感区域",
  sparse_cutaneous_boundary_input: "皮表边界点较稀疏",
};

const DIRECTION_SOURCE_LABELS: Record<string, string> = {
  rstl_atlas_weighted_nearest: "局部 RSTL 图谱",
  rstl_atlas_empty: "RSTL 图谱无可用支持点",
  rstl_atlas_no_valid_direction_support: "RSTL 图谱记录无有效方向支持",
};

const DIRECTION_HINT_LABELS: Record<string, string> = {
  parallel_to_lower_eyelid_margin_or_eyelid_crease: "平行下眼睑缘或睑皱襞",
  parallel_to_vermilion_border_or_white_roll: "平行唇红缘或白唇线",
  protect_commissure_alignment_with_manual_axis: "以人工方向保护口角对称",
  parallel_to_alar_groove_or_nasal_subunit_boundary: "平行鼻翼沟或鼻亚单位边界",
  manual_nasal_tip_subunit_axis: "人工确认鼻尖亚单位方向",
};

const OVERRIDE_LABELS: Record<string, string> = {
  manual_direction_confirmation: "人工确认候选方向",
  free_margin_distance_review: "复核功能与轮廓风险后再接受该方向",
  candidate_free_margin_distance_review: "复核完整切口路径与敏感游离缘距离",
  linear_length_or_access_review: "复核切口长度、影像直径或手术入路",
  redraw_cutaneous_boundary: "重新描绘皮表肿物边界",
  tumor_center_or_boundary_review: "复核肿物中心与边界位置",
  fusiform_shape_review: "复核梭形切口形态",
  fusiform_boundary_envelope_review: "复核边界是否完全位于梭形包络内",
  fusiform_length_or_margin_review: "复核梭形切口长度与安全切缘",
  override_reason_required: "记录偏离局部 RSTL 的医生理由",
};

function labelOf(labels: Record<string, string>, value: unknown, fallback = "未记录") {
  const key = String(value || "");
  return labels[key] || (key ? `未映射项（${key}）` : fallback);
}

export const tumorKindLabel = (value: unknown) => labelOf(TUMOR_KIND_LABELS, value, "未选择");
export const candidateTypeLabel = (value: unknown) => labelOf(CANDIDATE_TYPE_LABELS, value, "尚未生成");
export const reviewStatusLabel = (value: unknown) => labelOf(REVIEW_STATUS_LABELS, value, "待医生确认");
export const regionLabel = (value: unknown) => labelOf(REGION_LABELS, value, "尚未定位");
export const subunitLabel = (value: unknown) => labelOf(SUBUNIT_LABELS, value, "尚未定位");
export const reasonLabel = (value: unknown) => labelOf(REASON_LABELS, value);
export const guardrailLabel = (value: unknown) => labelOf(GUARDRAIL_LABELS, value);
export const directionSourceLabel = (value: unknown) => labelOf(DIRECTION_SOURCE_LABELS, value);
export const directionHintLabel = (value: unknown) => labelOf(DIRECTION_HINT_LABELS, value);
export const overrideLabel = (value: unknown) => labelOf(OVERRIDE_LABELS, value, "请医生复核");

export function rulesReviewLabel(reviewStatus: unknown) {
  return reviewStatus === "draft_not_clinically_validated"
    ? "研究规则草案 · 尚未完成临床验证"
    : labelOf({}, reviewStatus, "未记录验证状态");
}

export function severityLabel(severity: unknown) {
  if (severity === "high") return "高风险";
  if (severity === "medium") return "需复核";
  return "提示";
}
