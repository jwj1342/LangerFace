const TUMOR_KIND_LABELS: Record<string, string> = {
  subcutaneous: "皮下肿物",
  cutaneous: "皮表肿物",
};

export const TUMOR_DIAMETER_DISABLED_MESSAGE = "当前肿物范围由已绘制或已识别的边界决定，直径参数暂不参与候选生成。";
export const FREEHAND_MARKER_DISABLED_MESSAGE = "当前肿物边界由“自由轮廓鼠绘”的曲线决定，受控标记暂不参与候选生成；请切换为“椭圆近似”模式后使用。";

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
  candidate_intersects_non_skin_opening: "候选切口经过眼裂、口裂或鼻孔",
  candidate_intersects_default_vermilion_protection: "候选切口进入默认唇红保护区域",
  candidate_intersects_engineering_exclusion_zone: "候选切口进入不可规划的面部区域",
  candidate_outside_canonical_surface: "候选切口超出可用面部表面",
  invalid_candidate_geometry: "候选切口几何无效",
  invalid_candidate_surface_refs: "候选切口表面映射无效",
  missing_candidate_surface_refs: "候选切口缺少表面映射",
  tumor_boundary_intersects_non_skin_opening: "肿物边界进入眼裂、口裂或鼻孔",
  tumor_center_inside_non_skin_opening: "病灶中心位于眼裂、口裂或鼻孔",
  tumor_diameter_intersects_non_skin_opening: "肿物直径范围进入眼裂、口裂或鼻孔",
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
  personalized_rstl_atlas_weighted_nearest: "个体化 RSTL（YOLO/V6 皱纹证据）",
  rstl_atlas_nearest_segment: "最近 RSTL 线段局部切线",
  personalized_rstl_atlas_nearest_segment: "个体化 RSTL 最近线段局部切线",
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

const ENGINEERING_RECOVERY_LABELS: Record<string, string> = {
  candidate_intersects_non_skin_opening: "移动病灶或调整范围，确保完整候选不经过非皮肤开口",
  candidate_intersects_default_vermilion_protection: "调整位置或范围，确保完整候选避开唇红保护区域",
  candidate_intersects_engineering_exclusion_zone: "调整病灶位置或范围，避开不可规划区域后重试",
  candidate_outside_canonical_surface: "缩小范围或调整位置后重试；仍失败时由医生结合查体采用传统方法规划",
  invalid_candidate_geometry: "重新生成候选几何",
  invalid_candidate_surface_refs: "重新建立候选的面部表面映射",
  missing_candidate_surface_refs: "完成候选的面部表面映射后再复核",
  tumor_boundary_intersects_non_skin_opening: "保留原始记录，并把肿物边界重画到可见皮肤内",
  tumor_center_inside_non_skin_opening: "在可见皮肤上重新选择病灶中心",
  tumor_diameter_intersects_non_skin_opening: "缩小不准确的范围，或把病灶中心移到可见皮肤",
};

export const engineeringRecoveryLabel = (value: unknown) =>
  labelOf(ENGINEERING_RECOVERY_LABELS, value, "调整病灶或候选后重试");

export function engineeringBlockMessage(result: Record<string, any> | null | undefined): string {
  const tumorViolations = Array.isArray(result?.tumor_engineering_validation?.violations)
    ? result.tumor_engineering_validation.violations
    : [];
  const candidateViolations = Array.isArray(result?.candidate_alternatives)
    ? result.candidate_alternatives.flatMap((record: Record<string, any>) => record?.candidate?.hard_violations || [])
    : result?.candidate?.hard_violations || [];
  const codes = [...new Set([...tumorViolations, ...candidateViolations]
    .map((item: Record<string, any>) => String(item?.code || ""))
    .filter(Boolean))];
  if (!codes.length) return "候选未显示：允许的方向均未通过工程门禁；请调整病灶位置或范围后重试。";
  const violations = [...tumorViolations, ...candidateViolations];
  const hasNostrilOpening = violations.some((item: Record<string, any>) =>
    String(item?.location?.zone_id || item?.zone_id || "").includes("nostril"));
  const reasons = [...new Set(codes.map((code) => hasNostrilOpening && code.includes("non_skin_opening")
    ? "候选或肿物范围进入鼻孔等非皮肤开口"
    : guardrailLabel(code)))];
  return `候选未显示：${reasons.join("、")}；${engineeringRecoveryLabel(codes[0])}。`;
}

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

export function controlledMarkerFailureMessage(
  detection: Pick<ControlledMarkerDetection, "failure_code" | "diagnostics">,
): string {
  const stage = String(detection.diagnostics?.failure_stage || "");
  if (detection.failure_code === "invalid_image") return "照片暂时无法读取，请重新上传后再试。";
  if (detection.failure_code === "seed_outside_image") return "当前点击位置不在照片范围内，请在肿物边界内部重新点击。";
  if (detection.failure_code === "ambiguous_candidates") {
    return "当前区域有多个可能的肿物范围，请适当缩小扫描范围，使扫描面内只保留一个肿物边界后再试。";
  }
  if (detection.failure_code === "scan_range_too_small") {
    return "当前未形成完整肿物边界，请扩大扫描范围或补线后重试。";
  }
  if (detection.failure_code === "edge_discontinuous") {
    return "当前肿物边缘仍不连续，请扩大扫描范围或补线后重试。";
  }
  if (detection.failure_code === "unstable_enclosure") {
    if (stage === "detected_boundary_below_size_prior") {
      return "当前只识别到明显偏小的局部轮廓，可能是皮肤纹理或笔迹碎片；请把扫描中心放在完整肿物范围内后重试。";
    }
    return "当前只识别到局部轮廓，结果不足以代表完整肿物；请扩大扫描范围或补线后重试。";
  }
  if (detection.failure_code === "component_too_large" || stage === "marker_area_invalid") {
    return "当前识别范围过大，肿物边界可能与附近的深色区域连在一起，请重新绘制后再试。";
  }
  if (detection.failure_code === "low_contrast" || stage === "marker_contrast_low") {
    return "肿物边界颜色较浅，请加深后再试。";
  }
  if (stage === "seed_region_leaks_to_roi_border") {
    return "当前点击区域没有形成完整肿物范围，请扩大扫描范围或补线后重试。";
  }
  if (stage === "boundary_support_low" || stage === "boundary_support_missing") {
    return "肿物边界可能较浅或留有较大开口，请扩大扫描范围或补线后重试。";
  }
  return "当前点击区域未识别到肿物，请在肿物边界内部重新点击。";
}
import type { ControlledMarkerDetection } from "./controlledMarkerDetection";
