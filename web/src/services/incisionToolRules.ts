export const DEFAULT_RULES = {
  version: "0.2-agentic-incision",
  linear_subcutaneous: {
    length_multiplier: 1.25,
    min_length_mm: 8,
    max_length_mm: 35,
  },
  fusiform_cutaneous: {
    length_to_width_ratio: 3,
    tip_angle_deg: 30,
    min_length_mm: 12,
    max_length_mm: 80,
    samples: 56,
  },
  guardrails: {
    low_direction_confidence: 0.35,
    low_region_confidence: 0.45,
    free_margin_distance_warn_mm: 18,
    free_margin_distance_thresholds_mm: {
      default: 18,
      lower_eyelid: 16,
      lower_eyelid_margin: 16,
      lip_vermilion: 14,
      lip_vermilion_margin: 14,
      oral_commissure: 14,
      nasal_ala: 12,
      nasal_ala_margin: 12,
      nasal_tip: 10,
      inner_canthus: 14,
    },
    min_freehand_boundary_points: 6,
    min_boundary_area_diameter_disk_fraction: 0.08,
    boundary_center_shift_diameter_multiplier: 1,
    sensitive_regions: {
      lower_eyelid: "Protect the lower eyelid free margin; consider manual override away from vertical traction.",
      lip_vermilion: "Protect vermilion border alignment; require clinician confirmation before committing.",
      nasal_ala: "Protect nasal alar contour; evaluate distortion risk before accepting.",
      nasal_tip: "Protect nasal tip contour and support; require clinician confirmation before committing.",
      oral_commissure: "Protect oral commissure alignment and traction; require clinician confirmation before committing.",
    },
    protective_direction_hints: {
      lower_eyelid: {
        direction_hint: "parallel_to_lower_eyelid_margin_or_eyelid_crease",
        canonical_axis: [1, 0, 0],
        reason: "Prefer a clinician-confirmed axis that protects lower eyelid support before following local RSTL.",
      },
      lip_vermilion: {
        direction_hint: "parallel_to_vermilion_border_or_white_roll",
        canonical_axis: [1, 0, 0],
        reason: "Protect vermilion alignment; subunit border alignment may override local RSTL.",
      },
      oral_commissure: {
        direction_hint: "protect_commissure_alignment_with_manual_axis",
        canonical_axis: [1, 0, 0],
        reason: "Protect oral commissure symmetry and avoid unreviewed traction vectors.",
      },
      nasal_ala: {
        direction_hint: "parallel_to_alar_groove_or_nasal_subunit_boundary",
        canonical_axis: [0.65, 0.76, 0],
        reason: "Protect alar contour; nasal subunit boundary can override local RSTL.",
      },
      nasal_tip: {
        direction_hint: "manual_nasal_tip_subunit_axis",
        canonical_axis: [1, 0, 0],
        reason: "Protect nasal tip contour and support before following local RSTL.",
      },
    },
  },
};

export const TOOL_SCHEMAS = [
  { name: "classify_region", input: ["point"], output: ["region", "subunit", "confidence", "confidence_reasons", "region_boundary_margin_norm", "free_margin_distance_mm"] },
  { name: "summarize_tumor_input_quality", input: ["tumor"], output: ["passed", "warning_count", "warnings", "source", "boundary_source", "author_present", "units"] },
  { name: "query_rstl_direction", input: ["point", "source"], output: ["vector", "angle_deg", "confidence", "support_count", "angular_spread_deg", "confidence_reasons"] },
  { name: "inspect_sensitive_structures", input: ["anatomy", "candidate"], output: ["region", "nearby_landmarks", "center_free_margin_distance_mm", "center_free_margin_threshold_mm", "candidate_free_margin_distance_mm", "warnings", "protective_direction", "clinician_review_required"] },
  { name: "linear_subcutaneous_incision", input: ["tumor", "direction", "units_per_mm"], output: ["endpoints", "length_mm", "metrics"] },
  { name: "fusiform_cutaneous_incision", input: ["tumor", "direction", "units_per_mm"], output: ["outline", "length_mm", "width_mm", "metrics"] },
  { name: "evaluate_guardrails", input: ["candidate", "anatomy"], output: ["passed", "warnings", "suggested_overrides"] },
  { name: "preview_incision_on_face", input: ["candidate", "tumor", "anatomy", "guardrails"], output: ["renderable", "preview_space", "candidate_point_count", "tumor_boundary_point_count", "guardrails_passed", "clinician_review_required"] },
  { name: "clinician_edit_candidate", input: ["edit"], output: ["candidate", "guardrails", "provenance"] },
  { name: "compare_candidates", input: ["review_records"], output: ["ranked_candidates", "score_breakdown", "clinical_boundary"] },
  { name: "save_review_record", input: ["candidate", "tumor", "trace", "privacy_audit", "reviewer", "review_status", "review_notes"], output: ["review_record_json", "report_markdown", "screenshot_png", "audit_events"] },
];

export const AGENT_TRACE_GATE_REQUIRED = [
  { key: "tumor_input_quality", label: "肿物输入质量", actions: ["summarize_tumor_input_quality"] },
  { key: "face_region", label: "面部分区", actions: ["classify_region"] },
  { key: "rstl_direction", label: "RSTL 查询", actions: ["query_rstl_direction"] },
  { key: "sensitive_structures", label: "敏感结构检查", actions: ["inspect_sensitive_structures"] },
  { key: "candidate_generation", label: "确定性切口生成", actions: ["linear_subcutaneous_incision", "fusiform_cutaneous_incision"] },
  { key: "guardrails", label: "Guardrails", actions: ["evaluate_guardrails"] },
  { key: "face_preview", label: "面部预览", actions: ["preview_incision_on_face"] },
];

export const AGENT_REACT_PLAN_STEP_DEFINITIONS = [
  {
    id: "inspect_tumor_input",
    label: "检查肿物输入",
    intent: "在生成任何几何前检查结构化肿物输入。",
    required_action_groups: [["summarize_tumor_input_quality"]],
    optional_actions: [],
  },
  {
    id: "localize_anatomy",
    label: "定位面部分区",
    intent: "确定病灶所在面部分区和附近敏感游离缘。",
    required_action_groups: [["classify_region"]],
    optional_actions: [],
  },
  {
    id: "query_direction",
    label: "查询 RSTL 方向",
    intent: "从确定性 atlas 服务读取局部 RSTL 方向。",
    required_action_groups: [["query_rstl_direction"]],
    optional_actions: [],
  },
  {
    id: "inspect_sensitive_structures",
    label: "检查敏感结构",
    intent: "在候选几何进入审阅前测量游离缘距离和保护性方向例外。",
    required_action_groups: [["inspect_sensitive_structures"]],
    optional_actions: [],
  },
  {
    id: "generate_primary_candidate",
    label: "生成主候选",
    intent: "用确定性工具生成基线切口几何。",
    required_action_groups: [["linear_subcutaneous_incision", "fusiform_cutaneous_incision"]],
    optional_actions: [],
  },
  {
    id: "check_guardrails",
    label: "评估 Guardrails",
    intent: "在审阅前评估确定性临床保护规则。",
    required_action_groups: [["evaluate_guardrails"]],
    optional_actions: [],
  },
  {
    id: "preview_candidates",
    label: "预览候选",
    intent: "确认生成的几何能在标准脸上渲染。",
    required_action_groups: [["preview_incision_on_face"]],
    optional_actions: [],
  },
  {
    id: "compare_direction_variants",
    label: "比较方向备选",
    intent: "探索附近的确定性方向偏移，并保留失败恢复记录。",
    required_action_groups: [["propose_direction_variants"], ["compare_candidates"]],
    optional_actions: [
      "linear_subcutaneous_incision",
      "fusiform_cutaneous_incision",
      "inspect_sensitive_structures",
      "evaluate_guardrails",
      "preview_incision_on_face",
      "retry_tool_failure",
      "recover_tool_failure",
    ],
  },
];

export const SENSITIVE_ANCHORS = {
  left_lower_eyelid: [0.30, 0.59],
  right_lower_eyelid: [0.70, 0.59],
  left_nasal_ala: [0.40, 0.49],
  right_nasal_ala: [0.60, 0.49],
  nasal_tip: [0.50, 0.43],
  lip_vermilion: [0.50, 0.31],
  left_oral_commissure: [0.35, 0.32],
  right_oral_commissure: [0.65, 0.32],
};
export const SENSITIVE_MARGIN_SEGMENTS = {
  left_lower_eyelid_margin: [[0.20, 0.59], [0.42, 0.59]],
  right_lower_eyelid_margin: [[0.58, 0.59], [0.80, 0.59]],
  left_nasal_ala_margin: [[0.36, 0.45], [0.42, 0.52]],
  right_nasal_ala_margin: [[0.58, 0.52], [0.64, 0.45]],
  lip_vermilion_margin: [[0.34, 0.31], [0.66, 0.31]],
};
export const REGION_BOUNDARY_X = [
  0.12, 0.18, 0.20, 0.22, 0.24, 0.28, 0.30, 0.34, 0.36, 0.38,
  0.39, 0.42, 0.43, 0.44, 0.56, 0.57, 0.58, 0.61, 0.62, 0.64,
  0.66, 0.70, 0.72, 0.76, 0.78, 0.80, 0.82, 0.88,
];
export const REGION_BOUNDARY_Y = [
  0.22, 0.24, 0.28, 0.30, 0.34, 0.39, 0.40, 0.42, 0.47, 0.49,
  0.50, 0.53, 0.55, 0.56, 0.58, 0.62, 0.68, 0.76, 0.80,
];
export const REGION_TRANSITION_REASONS = {
  ear_region: "lateral_face_edge_bucket",
  temple_cheek: "lateral_face_transition",
  inner_canthus: "overlapping_sensitive_subunit",
  nasal_tip: "narrow_nasal_tip_band",
  nasolabial_fold: "nasolabial_transition_band",
  oral_commissure: "oral_commissure_transition_band",
  jawline: "jawline_or_face_boundary",
};
