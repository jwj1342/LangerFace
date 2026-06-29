import { Activity, ArrowLeft, ArrowRight, Camera, CheckCircle2, Download, FileText, Layers3, ListChecks, Plus, Save, ScanFace, ShieldAlert, SlidersHorizontal, Upload, Video } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ReactPage, ReactShell, ReactShellMain, ReactShellNavLink, ReactShellSidebar } from "../components/ReactShell";
import { ThreePreviewScene } from "../components/ThreePreviewScene";
import { WorkbenchBrand } from "../components/WorkbenchBrand";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Hint } from "../components/ui/hint";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { RouteStatus, StatusBadge } from "../components/ui/status-badge";
import { useReactRouteLifecycle } from "../hooks/useReactRouteLifecycle";
import { useStandardFaceAssets } from "../hooks/useStandardFaceAssets";
import {
  classifyCaseAge,
  deriveLesionBoundary,
  lesionLayerLabel,
  type AcquisitionQualityCheck,
  type CaseIncisionCandidateRecord,
  type ClinicalCaseRecord,
  type ClinicalCaseStep,
  type LesionBoundaryMode,
  type LesionBoundarySource,
} from "../services/dataSource";
import { CASE_STORE_BOUNDARY_NOTE, useCaseStore, type CaseSaveStatus } from "../stores/caseStore";

interface CaseWorkflowRouteProps {
  step?: ClinicalCaseStep | "new";
}

const STEP_LABELS: Record<ClinicalCaseStep, string> = {
  evaluate: "面部评估",
  plan: "切口规划",
  review: "方案确认",
};

const CLINICAL_COMPLIANCE_NOTES = [
  "本系统为临床辅助设计工具，不替代医生的专业判断，所有手术方案需由执业医师结合临床查体最终确认。",
  "系统默认适应证为可直接拉拢缝合的皮肤 / 皮下肿物；需皮瓣 / 植皮修复的病例，仅作切口方向参考。",
  "恶性病灶的安全切缘需以病理检查结果为最终标准。",
] as const;

function parseOptionalNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stepHref(caseId: string, step: ClinicalCaseStep) {
  return `/case/${caseId}/${step}`;
}

function viewportMode(source: ClinicalCaseRecord["acquisition"]["source"]) {
  if (source === "scan3d") return "3d";
  if (source === "realtime") return "live";
  return "2d";
}

function rstlDensityLabel(density: ClinicalCaseRecord["layers"]["rstlDensity"]) {
  if (density === "low") return "低密度";
  if (density === "high") return "高密度";
  return "标准密度";
}

function percentLabel(value: number) {
  return `${Math.round(value * 100)}%`;
}

function closureStatusLabel(status: ClinicalCaseRecord["closureSimulation"]["status"]) {
  if (status === "stable") return "闭合可行";
  if (status === "needs_review") return "需复核";
  return "待运行";
}

function acquisitionStatusLabel(status: ClinicalCaseRecord["acquisition"]["quality"]["status"]) {
  if (status === "ready") return "采集可用";
  if (status === "needs_attention") return "需复核";
  return "未采集";
}

function qualityCheckLabel(check: AcquisitionQualityCheck) {
  if (check === "pass") return "通过";
  if (check === "review") return "需复核";
  return "未检查";
}

function lesionBoundaryStatusLabel(status: ClinicalCaseRecord["lesion"]["boundary"]["status"]) {
  if (status === "ready") return "边界可用";
  if (status === "needs_review") return "需复核";
  return "未记录";
}

function lesionBoundaryModeLabel(mode: LesionBoundaryMode) {
  if (mode === "ellipse") return "椭圆边界";
  if (mode === "freehand") return "自由轮廓";
  return "中心点 + 直径";
}

function lesionBoundarySourceLabel(source: LesionBoundarySource) {
  if (source === "photo_trace") return "照片描记";
  if (source === "ultrasound") return "术前超声";
  if (source === "imported") return "导入记录";
  return "临床查体";
}

function effectiveLesionDiameter(activeCase: ClinicalCaseRecord) {
  const diameter = activeCase.lesion.diameterMm ?? null;
  const boundary = activeCase.lesion.boundary;
  const axis = boundary.axisDiameterMm ?? null;
  if (activeCase.lesion.layer === "cutaneous" && boundary.mode !== "center_diameter" && axis != null && axis > 0) {
    return diameter == null ? axis : Math.max(diameter, axis);
  }
  return diameter;
}

function lesionBoundaryTrace(activeCase: ClinicalCaseRecord) {
  const boundary = activeCase.lesion.boundary;
  const axis = boundary.axisDiameterMm == null ? "未填" : `${boundary.axisDiameterMm} mm`;
  const perpendicular = boundary.perpendicularDiameterMm == null ? "未填" : `${boundary.perpendicularDiameterMm} mm`;
  return [
    `${lesionBoundaryModeLabel(boundary.mode)} / ${lesionBoundarySourceLabel(boundary.source)}`,
    `状态：${lesionBoundaryStatusLabel(boundary.status)}`,
    boundary.mode === "freehand"
      ? `点数：${boundary.pointCount}`
      : `长轴：${axis}，短轴：${perpendicular}`,
    boundary.author ? `记录者：${boundary.author}` : "记录者：未填写",
  ].join("；");
}

function captureViewItems(source: ClinicalCaseRecord["acquisition"]["source"]) {
  const common = [
    { key: "frontal", label: "正位", required: true, hint: "面部中线与标尺可读" },
    { key: "leftOblique", label: "左斜位", required: source !== "realtime", hint: "补充左侧面颊和眶周" },
    { key: "rightOblique", label: "右斜位", required: source !== "realtime", hint: "补充右侧面颊和鼻唇沟" },
    { key: "profile", label: "侧位", required: false, hint: "必要时补充侧脸轮廓" },
    {
      key: "depthOrVideo",
      label: source === "scan3d" ? "深度序列" : source === "realtime" ? "实时片段" : "视频 / 深度",
      required: source === "scan3d" || source === "realtime",
      hint: source === "scan3d" ? "用于三维重建稳定性" : "用于动态追踪或补充取材",
    },
  ] as const;
  return common;
}

function acquisitionPathwayItems() {
  return [
    {
      source: "upload",
      title: "上传",
      subtitle: "高清照片 / 视频",
      description: "上传正位、斜位、侧位或视频序列，适合已有术前资料进入病例草稿。",
      views: "正位 + 左右斜位",
      permission: "无需设备权限",
      output: "2D 图像 / 视频序列",
      Icon: Upload,
    },
    {
      source: "photo",
      title: "拍照",
      subtitle: "标准位取材",
      description: "按正位、侧位、斜位完成设备拍照，适合门诊快速建立评估输入。",
      views: "正位 + 左右斜位",
      permission: "进入采集画布后申请相机权限",
      output: "标准位照片组",
      Icon: Camera,
    },
    {
      source: "scan3d",
      title: "3D 扫描",
      subtitle: "引导式三维重建",
      description: "补充深度或视频序列，优先用于需要三维面部重建和局部精度复核的病例。",
      views: "正位 + 左右斜位 + 深度序列",
      permission: "进入采集画布后申请相机权限",
      output: "3D 面部重建输入",
      Icon: ScanFace,
    },
    {
      source: "realtime",
      title: "实时",
      subtitle: "AR 动态跟踪",
      description: "用于实时录制、动态追踪和术前叠加预览，适合需要反复观察表情或姿态的场景。",
      views: "正位 + 实时视频",
      permission: "进入采集画布后申请相机权限",
      output: "实时叠加输入",
      Icon: Video,
    },
  ] as const;
}

function acquisitionPathwayStateLabel(
  activeCase: ClinicalCaseRecord,
  source: ClinicalCaseRecord["acquisition"]["source"],
) {
  if (activeCase.acquisition.source !== source) return "可切换";
  return acquisitionStatusLabel(activeCase.acquisition.quality.status);
}

function agePlanningRule(activeCase: ClinicalCaseRecord) {
  if (activeCase.patientContext.ageBand === "child_tight") {
    return {
      title: "儿童 / 紧致",
      metric: "3.5:1",
      description: "提示缩小梭形切口夹角，用更长的长轴分散高张力。",
    };
  }
  if (activeCase.patientContext.ageBand === "older_lax") {
    return {
      title: "老年 / 松弛",
      metric: "2.5:1",
      description: "提示适当增加梭形切口夹角，利用皮肤松弛度代偿。",
    };
  }
  if (activeCase.patientContext.ageBand === "adult_standard") {
    return {
      title: "中青年 / 普通",
      metric: "30° / 3:1",
      description: "维持基础尖端角和长轴:短轴比例。",
    };
  }
  return {
    title: "待填写年龄",
    metric: "待定",
    description: "填写年龄后，系统显示对应的尖端角和长轴:短轴建议。",
  };
}

function lesionPlanningRule(activeCase: ClinicalCaseRecord) {
  if (activeCase.lesion.layer === "cutaneous") {
    return {
      title: "皮表肿物",
      metric: "梭形",
      description: "结合皮表边界、类圆化直径、安全切缘和局部 RSTL 方向生成候选。",
    };
  }
  return {
    title: "皮下肿物",
    metric: "线性",
    description: "根据医生在皮肤表面描记的肿物轮廓类圆直径生成线性切口，无需梭形。",
  };
}

function lesionBoundaryPlanningRule(activeCase: ClinicalCaseRecord) {
  const boundary = activeCase.lesion.boundary;
  return {
    title: lesionBoundaryModeLabel(boundary.mode),
    metric: lesionBoundaryStatusLabel(boundary.status),
    description: boundary.summary,
  };
}

function marginPlanningRule(activeCase: ClinicalCaseRecord) {
  const margin = activeCase.lesion.marginStrategy === "expanded_margin"
    ? Math.max(0, activeCase.lesion.safetyMarginMm ?? 0)
    : 0;
  const diameter = effectiveLesionDiameter(activeCase);
  const width = diameter == null ? null : diameter + margin * 2;
  if (activeCase.lesion.marginStrategy === "expanded_margin") {
    return {
      title: "需扩大安全切缘",
      metric: `${margin || "未填"} mm`,
      description: width == null
        ? "医生手动输入扩大范围；最终以病理切缘阴性为标准。"
        : `估算切除宽度 ${width.toFixed(1)} mm；最终以病理切缘阴性为标准。`,
    };
  }
  return {
    title: "常规完整切除",
    metric: "贴近病变",
    description: "默认切缘贴近病变，以完整切除为准；系统不判断良恶性。",
  };
}

function candidateRatioForAge(activeCase: ClinicalCaseRecord) {
  if (activeCase.patientContext.ageBand === "child_tight") return 3.5;
  if (activeCase.patientContext.ageBand === "older_lax") return 2.5;
  return 3;
}

function candidateTipAngleForAge(activeCase: ClinicalCaseRecord) {
  if (activeCase.patientContext.ageBand === "child_tight") return 24;
  if (activeCase.patientContext.ageBand === "older_lax") return 36;
  return 30;
}

function candidateKindLabel(kind: CaseIncisionCandidateRecord["kind"]) {
  return kind === "linear" ? "线性切口" : "梭形切口";
}

function candidateStatusLabel(status: CaseIncisionCandidateRecord["status"]) {
  if (status === "selected") return "当前选中";
  if (status === "needs_review") return "待审阅";
  return "草稿";
}

function reviewDecisionLabel(decision: ClinicalCaseRecord["reviewRecord"]["decision"]) {
  if (decision === "approved") return "已确认";
  if (decision === "needs_revision") return "退回修改";
  if (decision === "rejected") return "不采用";
  return "待审阅";
}

function formatCandidateMetric(value: number | null, unit = "mm") {
  return value == null ? "待定" : `${value.toFixed(1)} ${unit}`;
}

function safeExportFilePart(value: string) {
  const normalized = value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.slice(0, 64) || "case";
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function buildCaseReviewExport(
  activeCase: ClinicalCaseRecord,
  selectedCandidate: CaseIncisionCandidateRecord | null,
) {
  return {
    schema: "langerface-case-review-export/v0.1",
    exportedAt: new Date().toISOString(),
    privacy: {
      rawImageIncluded: false,
      rawVideoIncluded: false,
      canvasPixelsIncluded: false,
      providerSecretIncluded: false,
      note: "仅包含结构化病例参数、候选摘要、规则记录和合规提示。",
    },
    case: {
      id: activeCase.id,
      title: activeCase.title,
      status: activeCase.status,
      createdAt: activeCase.createdAt,
      updatedAt: activeCase.updatedAt,
      patientContext: activeCase.patientContext,
      acquisition: activeCase.acquisition,
      lesion: activeCase.lesion,
      layers: activeCase.layers,
      closureSimulation: activeCase.closureSimulation,
      selectedCandidateId: activeCase.selectedCandidateId,
      selectedCandidate,
      incisionCandidates: activeCase.incisionCandidates,
      reviewRecord: activeCase.reviewRecord,
    },
    clinicalCompliance: [...CLINICAL_COMPLIANCE_NOTES],
  };
}

function buildCaseReportDraft(
  activeCase: ClinicalCaseRecord,
  selectedCandidate: CaseIncisionCandidateRecord | null,
) {
  const lesionMargin = activeCase.lesion.marginStrategy === "expanded_margin"
    ? `扩大安全切缘 ${activeCase.lesion.safetyMarginMm ?? "未填"} mm`
    : "常规完整切除";
  const candidateMetrics = selectedCandidate
    ? [
        `- 候选：${selectedCandidate.label} · ${candidateKindLabel(selectedCandidate.kind)}`,
        `- 长度：${formatCandidateMetric(selectedCandidate.lengthMm)}`,
        `- 宽度 / 比例：${selectedCandidate.widthMm == null ? "线性切口" : `${selectedCandidate.widthMm.toFixed(1)} mm / ${selectedCandidate.ratio?.toFixed(1) ?? "待定"}:1`}`,
        `- 尖端角：${selectedCandidate.tipAngleDeg == null ? "不适用" : `${selectedCandidate.tipAngleDeg}°`}`,
        `- 复核提示：${selectedCandidate.guardrailSummary}`,
      ].join("\n")
    : "- 当前尚未保存候选方案。";
  const ruleTrace = selectedCandidate?.provenance.ruleTrace.length
    ? selectedCandidate.provenance.ruleTrace.map((item) => `- ${item}`).join("\n")
    : "- 规则记录待补充。";
  const compliance = CLINICAL_COMPLIANCE_NOTES.map((item) => `- ${item}`).join("\n");

  return [
    "# 面部松弛皮肤张力线智能切口设计系统 - 报告草案",
    "",
    `- 导出时间：${new Date().toISOString()}`,
    `- 病例编号：${activeCase.id}`,
    `- 病例标题：${activeCase.title}`,
    `- 当前状态：${activeCase.status}`,
    "",
    "## 病例前置参数",
    "",
    `- 年龄分档：${activeCase.patientContext.ageBandLabel}`,
    `- 采集方式：${activeCase.acquisition.sourceLabel}`,
    `- 采集质量：${acquisitionStatusLabel(activeCase.acquisition.quality.status)}；${activeCase.acquisition.quality.summary}`,
    `- 病灶层次：${activeCase.lesion.layerLabel}`,
    `- 病灶直径：${activeCase.lesion.diameterMm ?? "未填"} mm`,
    `- 病灶深度：${activeCase.lesion.depthMm ?? "未填"} mm`,
    `- 病灶边界：${lesionBoundaryStatusLabel(activeCase.lesion.boundary.status)}；${lesionBoundaryTrace(activeCase)}`,
    `- 切缘策略：${lesionMargin}`,
    "",
    "## 图层状态",
    "",
    `- RSTL：${activeCase.layers.rstl ? `${rstlDensityLabel(activeCase.layers.rstlDensity)} / ${percentLabel(activeCase.layers.rstlOpacity)}` : "关闭"}`,
    `- 个性化皮纹：${activeCase.layers.personalizedWrinkles ? percentLabel(activeCase.layers.wrinkleOpacity) : "关闭"}`,
    `- 混合场：${activeCase.layers.blendedField ? "开启" : "关闭"}`,
    `- 切口设计：${activeCase.layers.incisionDesign ? "开启" : "关闭"}`,
    "",
    "## 采集质量",
    "",
    `- 完整性状态：${acquisitionStatusLabel(activeCase.acquisition.quality.status)}`,
    `- 已记录视角：${captureViewItems(activeCase.acquisition.source).filter((item) => activeCase.acquisition.captureSet[item.key]).map((item) => item.label).join("、") || "未记录"}`,
    `- 对焦：${qualityCheckLabel(activeCase.acquisition.quality.focus)}`,
    `- 曝光：${qualityCheckLabel(activeCase.acquisition.quality.exposure)}`,
    `- 姿态覆盖：${qualityCheckLabel(activeCase.acquisition.quality.poseCoverage)}`,
    `- 跟踪稳定：${qualityCheckLabel(activeCase.acquisition.quality.tracking)}`,
    `- 摘要：${activeCase.acquisition.quality.summary}`,
    "",
    "## 病灶边界",
    "",
    `- 边界模式：${lesionBoundaryModeLabel(activeCase.lesion.boundary.mode)}`,
    `- 来源：${lesionBoundarySourceLabel(activeCase.lesion.boundary.source)}`,
    `- 记录者：${activeCase.lesion.boundary.author || "未填写"}`,
    `- 边界状态：${lesionBoundaryStatusLabel(activeCase.lesion.boundary.status)}`,
    `- 长轴：${activeCase.lesion.boundary.axisDiameterMm ?? "未填"} mm`,
    `- 短轴：${activeCase.lesion.boundary.perpendicularDiameterMm ?? "未填"} mm`,
    `- 自由轮廓点数：${activeCase.lesion.boundary.pointCount}`,
    `- 摘要：${activeCase.lesion.boundary.summary}`,
    "",
    "## 当前候选",
    "",
    candidateMetrics,
    "",
    "## 规则记录",
    "",
    ruleTrace,
    "",
    "## 张力闭合模拟",
    "",
    `- 状态：${closureStatusLabel(activeCase.closureSimulation.status)}`,
    `- 评分：${activeCase.closureSimulation.score == null ? "未运行" : `${activeCase.closureSimulation.score} / 100`}`,
    `- 结论：${activeCase.closureSimulation.label}`,
    `- 摘要：${activeCase.closureSimulation.summary}`,
    "",
    "## 医生审阅记录",
    "",
    `- 审阅医生：${activeCase.reviewRecord.reviewerName || "未填写"}`,
    `- 审阅结论：${reviewDecisionLabel(activeCase.reviewRecord.decision)}`,
    `- 审阅时间：${activeCase.reviewRecord.reviewedAt || "未确认"}`,
    `- 审阅备注：${activeCase.reviewRecord.note || "无"}`,
    `- 覆盖 / 退回原因：${activeCase.reviewRecord.overrideReason || "无"}`,
    "",
    "## 临床合规提示",
    "",
    compliance,
    "",
    "> 本报告为前端本地生成的草案，不等于正式病历保存或最终手术方案。",
    "",
  ].join("\n");
}

function buildCaseCandidate(activeCase: ClinicalCaseRecord): CaseIncisionCandidateRecord | null {
  const diameter = effectiveLesionDiameter(activeCase);
  if (diameter == null || diameter <= 0) return null;
  const now = new Date().toISOString();
  const margin = activeCase.lesion.marginStrategy === "expanded_margin"
    ? Math.max(0, activeCase.lesion.safetyMarginMm ?? 0)
    : 0;
  const excisionWidth = diameter + margin * 2;
  const version = activeCase.incisionCandidates.length + 1;
  const kind = activeCase.lesion.layer === "cutaneous" ? "fusiform" : "linear";
  const ratio = kind === "fusiform" ? candidateRatioForAge(activeCase) : null;
  const tipAngleDeg = kind === "fusiform" ? candidateTipAngleForAge(activeCase) : null;
  const lengthMm = kind === "fusiform"
    ? excisionWidth * (ratio ?? 3)
    : Math.max(excisionWidth, diameter * 1.2);
  const widthMm = kind === "fusiform" ? excisionWidth : null;
  const needsReview = activeCase.patientContext.ageBand === "unknown" || margin >= 10 || excisionWidth >= 30;
  const guardrailSummary = needsReview
    ? "参数接近复核阈值，需医生结合查体确认。"
    : "基础规则未触发高风险提示，仍需医生确认。";
  const ruleTrace = [
    `年龄分档：${activeCase.patientContext.ageBandLabel}`,
    `病灶层次：${activeCase.lesion.layerLabel}`,
    `病灶边界：${lesionBoundaryTrace(activeCase)}`,
    activeCase.lesion.marginStrategy === "expanded_margin"
      ? `安全切缘：${margin} mm`
      : "切缘策略：常规完整切除",
    `图层状态：RSTL ${activeCase.layers.rstl ? `${rstlDensityLabel(activeCase.layers.rstlDensity)} ${percentLabel(activeCase.layers.rstlOpacity)}` : "关闭"}，皮纹 ${activeCase.layers.personalizedWrinkles ? percentLabel(activeCase.layers.wrinkleOpacity) : "关闭"}`,
    kind === "fusiform"
      ? `梭形参数：${tipAngleDeg}° / ${ratio}:1`
      : "线性参数：沿局部 RSTL 方向",
    `采集质量：${acquisitionStatusLabel(activeCase.acquisition.quality.status)}`,
  ];

  return {
    id: `candidate_${Date.now().toString(36)}_${version}`,
    version,
    label: `候选 ${version}`,
    kind,
    status: "needs_review",
    lengthMm,
    widthMm,
    tipAngleDeg,
    ratio,
    safetyMarginMm: margin,
    ruleSummary: kind === "fusiform"
      ? `估算切除宽度 ${excisionWidth.toFixed(1)} mm，长轴约 ${lengthMm.toFixed(1)} mm。`
      : `估算线性切口长度 ${lengthMm.toFixed(1)} mm；无需设计梭形。`,
    guardrailSummary,
    createdAt: now,
    updatedAt: now,
    provenance: {
      source: "病例规划页确定性规则",
      author: "本地病例草稿",
      ageBand: activeCase.patientContext.ageBand,
      lesionLayer: activeCase.lesion.layer,
      marginStrategy: activeCase.lesion.marginStrategy,
      ruleTrace,
    },
  };
}

function estimateClosureSimulation(activeCase: ClinicalCaseRecord): ClinicalCaseRecord["closureSimulation"] {
  const now = new Date().toISOString();
  const diameter = effectiveLesionDiameter(activeCase);
  if (diameter == null || diameter <= 0) {
    return {
      status: "needs_review",
      score: null,
      label: "资料不足",
      summary: "请先填写病灶直径和切缘策略，再运行本步骤内的张力闭合模拟。",
      lastRunAt: now,
    };
  }

  const safetyMargin = activeCase.lesion.marginStrategy === "expanded_margin"
    ? Math.max(0, activeCase.lesion.safetyMarginMm ?? 0)
    : 0;
  const excisionWidth = diameter + safetyMargin * 2;
  const ageAdjustment = activeCase.patientContext.ageBand === "older_lax"
    ? 10
    : activeCase.patientContext.ageBand === "child_tight"
      ? -10
      : 0;
  const layerAdjustment = activeCase.lesion.layer === "subcutaneous" ? 6 : -2;
  const sizePenalty = Math.max(0, excisionWidth - 8) * 1.25;
  const marginPenalty = safetyMargin >= 10 ? 10 : safetyMargin >= 5 ? 5 : 0;
  const score = Math.max(30, Math.min(96, Math.round(84 + ageAdjustment + layerAdjustment - sizePenalty - marginPenalty)));
  const needsReview = score < 68 || safetyMargin >= 10 || excisionWidth >= 30;
  const label = needsReview ? "需医生复核" : "可直接拉拢";
  const summary = needsReview
    ? `估算切除宽度 ${excisionWidth.toFixed(1)} mm；当前参数可能超过简单拉拢缝合舒适区，建议复核皮肤松弛度、张力方向和是否需要皮瓣 / 植皮方案。`
    : `估算切除宽度 ${excisionWidth.toFixed(1)} mm；当前参数支持在规划页内继续查看闭合方向和张力提示，最终仍需医生结合查体确认。`;

  return {
    status: needsReview ? "needs_review" : "stable",
    score,
    label,
    summary,
    lastRunAt: now,
  };
}

function caseStepStateLabel(
  activeCase: ClinicalCaseRecord,
  item: ClinicalCaseStep,
  currentStep: ClinicalCaseStep,
  saveStatus: CaseSaveStatus,
) {
  if (item === currentStep) {
    if (saveStatus === "saving") return "保存中";
    if (saveStatus === "dirty") return "未保存";
    if (saveStatus === "save_failed") return "保存失败";
  }
  if (item === "evaluate") {
    if (activeCase.acquisition.quality.status === "not_started") return "待采集";
    if (activeCase.acquisition.quality.status === "needs_attention") return "需复核";
    return activeCase.patientContext.ageYears == null ? "待完善" : "已保存";
  }
  if (item === "plan") {
    if (activeCase.status === "needs_review") return "待审阅";
    if (activeCase.status === "confirmed" || activeCase.status === "exported") return "已完成";
    return activeCase.lesion.diameterMm == null ? "待完善" : "已保存";
  }
  if (activeCase.status === "confirmed") return "已确认";
  if (activeCase.status === "exported") return "已导出";
  if (activeCase.status === "needs_review") return "待审阅";
  return "未开始";
}

function SaveStatusBadge() {
  const saveStatus = useCaseStore((state) => state.saveStatus);
  const label = saveStatus === "saving"
    ? "保存中"
    : saveStatus === "dirty"
      ? "未保存"
      : saveStatus === "save_failed"
        ? "保存失败"
        : "已保存";
  return <RouteStatus className={`case-save-status case-save-status-${saveStatus} clinical-number`}>{label}</RouteStatus>;
}

function CaseStepper({ activeCase, step }: { activeCase: ClinicalCaseRecord; step: ClinicalCaseStep }) {
  const saveStatus = useCaseStore((state) => state.saveStatus);
  return (
    <Card className="case-stepper" id="caseStepper">
      <CardHeader><span>病例步骤</span><SaveStatusBadge /></CardHeader>
      <CardContent>
        {(["evaluate", "plan", "review"] as ClinicalCaseStep[]).map((item, index) => {
          const stateLabel = caseStepStateLabel(activeCase, item, step, saveStatus);
          return (
            <ReactShellNavLink
              key={item}
              className={item === step ? "case-step-active" : undefined}
              to={stepHref(activeCase.id, item)}
            >
              <span className="case-step-label">
                <b>{index + 1}. {STEP_LABELS[item]}</b>
                <small>{item === step ? "当前步骤，可保存后继续" : "可返回微调，草稿保留"}</small>
              </span>
              <span className={`case-step-state case-step-state-${stateLabel}`}>{stateLabel}</span>
              {item === step ? <CheckCircle2 size={16} /> : <ArrowRight size={16} />}
            </ReactShellNavLink>
          );
        })}
      </CardContent>
    </Card>
  );
}

function CaseWorkflowShell({
  activeCase,
  children,
  step,
}: {
  activeCase: ClinicalCaseRecord;
  children: ReactNode;
  step: ClinicalCaseStep;
}) {
  const lastError = useCaseStore((state) => state.lastError);

  return (
    <ReactPage className="case-workflow-page">
      <ReactShell>
        <ReactShellSidebar>
          <WorkbenchBrand
            eyebrow="RSTL 智能切口设计系统"
            title="面部松弛皮肤张力线智能切口设计系统"
            action={<SaveStatusBadge />}
          />

          <Card>
            <CardHeader><span>当前病例</span><span className="clinical-number">{activeCase.id.slice(0, 14)}</span></CardHeader>
            <CardContent>
              <Hint>{activeCase.title}</Hint>
              <div className="case-mini-grid">
                <div><span>年龄</span><b className="clinical-number">{activeCase.patientContext.ageYears ?? "未填"}</b></div>
                <div><span>分档</span><b>{activeCase.patientContext.ageBandLabel}</b></div>
                <div><span>病灶</span><b>{activeCase.lesion.layer === "cutaneous" ? "皮表" : "皮下"}</b></div>
                <div><span>切缘</span><b>{activeCase.lesion.marginStrategy === "expanded_margin" ? "扩大" : "常规"}</b></div>
                <div><span>采集</span><b>{activeCase.acquisition.sourceLabel}</b></div>
                <div><span>质量</span><b>{acquisitionStatusLabel(activeCase.acquisition.quality.status)}</b></div>
              </div>
              {lastError ? <Hint className="danger-text">{lastError}</Hint> : null}
            </CardContent>
          </Card>

          <CaseStepper activeCase={activeCase} step={step} />

          <Card>
            <CardHeader><span>系统入口</span><span>设置</span></CardHeader>
            <CardContent>
              <ReactShellNavLink to="/settings/atlas"><span>图谱库管理</span><Layers3 size={16} /></ReactShellNavLink>
              <ReactShellNavLink to="/settings/developer"><span>系统诊断</span><SlidersHorizontal size={16} /></ReactShellNavLink>
            </CardContent>
          </Card>
        </ReactShellSidebar>

        <ReactShellMain className="case-workflow-main">
          {children}
        </ReactShellMain>
      </ReactShell>
    </ReactPage>
  );
}

function CaseClinicalViewport({
  activeCase,
  step,
}: {
  activeCase: ClinicalCaseRecord;
  step: ClinicalCaseStep;
}) {
  const { assets, loadingText } = useStandardFaceAssets({
    failedRouteStatus: "病例三维面部模型加载失败",
    initialLoadingText: "正在加载标准三维面部模型",
    loadedAssetStatus: "病例三维面部模型已加载",
    loadedRouteStatus: "病例画布已就绪",
    loadingAssetStatus: "病例三维面部模型加载中",
    loadingRouteStatus: "病例画布加载中",
    progressFallbackLabel: "病例三维面部模型",
  });
  const stepLabel = STEP_LABELS[step];
  const marginLabel = activeCase.lesion.marginStrategy === "expanded_margin"
    ? `${activeCase.lesion.safetyMarginMm ?? "未填"} mm`
    : "常规";
  const layerItems = [
    ["RSTL", activeCase.layers.rstl, `${rstlDensityLabel(activeCase.layers.rstlDensity)} · ${percentLabel(activeCase.layers.rstlOpacity)}`],
    ["皮纹", activeCase.layers.personalizedWrinkles, percentLabel(activeCase.layers.wrinkleOpacity)],
    ["混合场", activeCase.layers.blendedField, "融合调优"],
    ["切口", activeCase.layers.incisionDesign, "候选显示"],
  ] as const;
  const activeMode = viewportMode(activeCase.acquisition.source);

  return (
    <section className={`case-clinical-viewport case-clinical-viewport-${step}`} aria-label={`${stepLabel}临床画布`}>
      <div className="case-viewport-toolbar">
        <div>
          <span>病例画布</span>
          <b>{stepLabel}</b>
        </div>
        <div className="case-viewport-mode-switch" aria-label="视图模式">
          <span className={activeMode === "2d" ? "is-active" : undefined}>2D 图像</span>
          <span className={activeMode === "3d" ? "is-active" : undefined}>3D 重建</span>
          <span className={activeMode === "live" ? "is-active" : undefined}>实时叠加</span>
        </div>
        <RouteStatus className={`case-viewport-status case-acquisition-status-${activeCase.acquisition.quality.status}`}>
          {acquisitionStatusLabel(activeCase.acquisition.quality.status)}
        </RouteStatus>
      </div>
      <div className="case-viewport-body">
        <div className="case-face-asset-frame" data-loaded={assets ? "true" : "false"}>
          <ThreePreviewScene assets={assets} loadingText={loadingText} />
          <div className="case-face-clinical-overlay" aria-hidden="true">
            <span className="case-face-overlay-label">病例内标准三维面部模型</span>
            <span className={`case-face-overlay-lesion case-face-overlay-lesion-${activeCase.lesion.boundary.mode}`} />
            {activeCase.layers.incisionDesign ? <span className="case-face-overlay-incision" /> : null}
            <span className="case-face-overlay-zone case-face-overlay-zone-eye" />
            <span className="case-face-overlay-zone case-face-overlay-zone-mouth" />
            <span className="case-face-ruler"><b>10 mm</b></span>
            <span className="case-face-coordinate">R12 / Z05</span>
          </div>
        </div>
        <div className="case-viewport-readout">
          <div><span>年龄分档</span><b>{activeCase.patientContext.ageBandLabel}</b></div>
          <div><span>病灶层次</span><b>{activeCase.lesion.layerLabel}</b></div>
          <div><span>直径</span><b className="clinical-number">{activeCase.lesion.diameterMm ?? "未填"} mm</b></div>
          <div><span>切缘</span><b className="clinical-number">{marginLabel}</b></div>
          <div><span>输入质量</span><b>{acquisitionStatusLabel(activeCase.acquisition.quality.status)}</b></div>
          <div><span>病灶边界</span><b>{lesionBoundaryStatusLabel(activeCase.lesion.boundary.status)}</b></div>
        </div>
      </div>
      <div className="case-viewport-layer-strip" aria-label="图层状态">
        {layerItems.map(([label, enabled, detail]) => (
          <span key={label} className={enabled ? "is-on" : undefined}>
            <b>{label}</b>
            <small>{enabled ? detail : "关闭"}</small>
          </span>
        ))}
      </div>
    </section>
  );
}

function CaseTaskStrip({
  items,
}: {
  items: Array<{ index: string; title: string; description: string }>;
}) {
  return (
    <div className="case-task-strip" aria-label="当前阶段任务">
      {items.map((item) => (
        <div key={item.index} className="case-task-strip-item">
          <span className="clinical-number">{item.index}</span>
          <b>{item.title}</b>
          <small>{item.description}</small>
        </div>
      ))}
    </div>
  );
}

function CaseHandoffPanel({
  eyebrow,
  title,
  description,
  to,
  actionLabel,
  items,
}: {
  eyebrow: string;
  title: string;
  description: string;
  to?: string;
  actionLabel?: string;
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <section className="case-handoff-panel">
      <div className="case-handoff-header"><span>{eyebrow}</span><ArrowRight size={16} /></div>
      <div className="case-handoff-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="case-handoff-list">
        {items.map((item) => (
          <p key={item.label}>
            <b>{item.label}</b>
            <span>{item.value}</span>
          </p>
        ))}
      </div>
      {to && actionLabel ? (
        <Button asChild variant="workbench">
          <Link to={to}>{actionLabel}</Link>
        </Button>
      ) : null}
    </section>
  );
}

function PlanningRationalePanel({ activeCase }: { activeCase: ClinicalCaseRecord }) {
  const ageRule = agePlanningRule(activeCase);
  const lesionRule = lesionPlanningRule(activeCase);
  const boundaryRule = lesionBoundaryPlanningRule(activeCase);
  const marginRule = marginPlanningRule(activeCase);
  const rules = [
    {
      label: "年龄规则",
      ...ageRule,
    },
    {
      label: "切口模式",
      ...lesionRule,
    },
    {
      label: "病灶边界",
      ...boundaryRule,
    },
    {
      label: "切缘策略",
      ...marginRule,
    },
    {
      label: "警惕区",
      title: "眼睑 / 口唇 / 鼻翼",
      metric: "需复核",
      description: "接近警惕区时，候选只作为方向参考，建议结合专科医生个性化设计。",
    },
  ];

  return (
    <Card className="case-planning-rationale">
      <CardHeader>
        <span>规划依据与风险提示</span>
        <ShieldAlert size={16} />
      </CardHeader>
      <CardContent>
        <div className="case-rule-grid" aria-label="规划依据">
          {rules.map((rule) => (
            <article key={rule.label} className="case-rule-card">
              <span>{rule.label}</span>
              <b>{rule.title}</b>
              <strong className="clinical-number">{rule.metric}</strong>
              <p>{rule.description}</p>
            </article>
          ))}
        </div>
        <div className="case-rationale-audit" aria-label="审计记录边界">
          <p><b>规则记录</b><span>候选生成应记录年龄分档、病灶层次、病灶边界、切缘策略、图层状态和医生修改。</span></p>
          <p><b>临床边界</b><span>系统只生成辅助草案，不判断良恶性，不输出自动手术指令。</span></p>
          <p><b>保存边界</b><span>当前为本地病例草稿；正式审阅记录后续进入院内或云端病例库。</span></p>
        </div>
      </CardContent>
    </Card>
  );
}

function PlanningRationaleSummary({ activeCase }: { activeCase: ClinicalCaseRecord }) {
  const ageRule = agePlanningRule(activeCase);
  const lesionRule = lesionPlanningRule(activeCase);
  const marginRule = marginPlanningRule(activeCase);
  const items = [
    { label: "年龄", title: ageRule.title, metric: ageRule.metric },
    { label: "模式", title: lesionRule.title, metric: lesionRule.metric },
    { label: "切缘", title: marginRule.title, metric: marginRule.metric },
    { label: "警惕区", title: "眼睑 / 口唇 / 鼻翼", metric: "需复核" },
  ];

  return (
    <div className="case-rationale-summary" aria-label="规划依据摘要">
      <div className="case-rationale-summary-head">
        <span>规划依据摘要</span>
        <small>候选生成前可见，完整记录在下方审计区</small>
      </div>
      <div className="case-rationale-summary-grid">
        {items.map((item) => (
          <span key={item.label}>
            <b>{item.label}</b>
            <strong className="clinical-number">{item.metric}</strong>
            <small>{item.title}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

function CaseCandidateQueue({
  activeCase,
  onGenerate,
  onSelect,
  readonly = false,
}: {
  activeCase: ClinicalCaseRecord;
  onGenerate?: () => void;
  onSelect?: (candidateId: string) => void;
  readonly?: boolean;
}) {
  const candidates = activeCase.incisionCandidates;
  const selectedId = activeCase.selectedCandidateId;
  const effectiveDiameter = effectiveLesionDiameter(activeCase);
  const canGenerate = effectiveDiameter != null && effectiveDiameter > 0;

  return (
    <Card className="case-candidate-panel" id="caseCandidatePanel">
      <CardHeader>
        <span>候选方案队列</span>
        <span className="clinical-number">{candidates.length}</span>
      </CardHeader>
      <CardContent>
        <div className="case-candidate-header">
          <div>
            <b>病例内候选草稿</b>
            <p>候选摘要保存在当前病例草稿中，用于回退微调、审阅和导出前确认。</p>
          </div>
          {!readonly ? (
            <Button
              disabled={!canGenerate}
              type="button"
              variant="workbenchPrimary"
              onClick={onGenerate}
            >
              <ListChecks size={16} />保存候选草案
            </Button>
          ) : null}
        </div>
        {!canGenerate && !readonly ? (
          <Hint>请先填写病灶直径，再保存候选草案。</Hint>
        ) : null}
        {candidates.length ? (
          <div className="case-candidate-list" aria-label="候选方案队列">
            {candidates.map((candidate) => {
              const selected = candidate.id === selectedId;
              return (
                <article key={candidate.id} className={`case-candidate-row${selected ? " is-selected" : ""}`}>
                  <div className="case-candidate-row-top">
                    <div>
                      <span>v{candidate.version}</span>
                      <b>{candidate.label} · {candidateKindLabel(candidate.kind)}</b>
                    </div>
                    <RouteStatus className="case-candidate-state">{selected ? "当前选中" : candidateStatusLabel(candidate.status)}</RouteStatus>
                  </div>
                  <div className="case-candidate-metrics">
                    <div><span>长度</span><b className="clinical-number">{formatCandidateMetric(candidate.lengthMm)}</b></div>
                    <div><span>宽度 / 比例</span><b className="clinical-number">{candidate.widthMm == null ? "线性" : `${candidate.widthMm.toFixed(1)} mm / ${candidate.ratio?.toFixed(1) ?? "—"}:1`}</b></div>
                    <div><span>尖端角</span><b className="clinical-number">{candidate.tipAngleDeg == null ? "—" : `${candidate.tipAngleDeg}°`}</b></div>
                    <div><span>复核提示</span><b>{candidate.guardrailSummary}</b></div>
                  </div>
                  <div className="case-candidate-rationale">
                    <b>规则记录</b>
                    <span>{candidate.provenance.ruleTrace.join("；") || candidate.ruleSummary}</span>
                  </div>
                  {!readonly && !selected ? (
                    <div className="case-inline-actions">
                      <Button type="button" variant="workbench" onClick={() => onSelect?.(candidate.id)}>
                        设为当前候选
                      </Button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="case-empty-state case-candidate-empty">
            <FileText size={22} />
            <p>暂无候选草案。保存候选后，方案确认页会显示版本、指标和规则记录。</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AcquisitionQualityGate({ activeCase }: { activeCase: ClinicalCaseRecord }) {
  const updateActiveCase = useCaseStore((state) => state.updateActiveCase);
  const statusLabel = acquisitionStatusLabel(activeCase.acquisition.quality.status);
  const qualityChecks = [
    ["focus", "对焦清晰", "病灶边界和面部纹理可辨"],
    ["exposure", "曝光可读", "不过曝、不欠曝，肤色层次可见"],
    ["poseCoverage", "姿态覆盖", "正斜位或动态范围覆盖目标区域"],
    ["tracking", "跟踪稳定", "3D 扫描或实时模式下无明显漂移"],
  ] as const;
  const updateCaptureSet = (
    key: keyof ClinicalCaseRecord["acquisition"]["captureSet"],
    checked: boolean,
  ) => updateActiveCase({
    acquisition: {
      captureSet: { [key]: checked } as Partial<ClinicalCaseRecord["acquisition"]["captureSet"]>,
      quality: { lastCheckedAt: new Date().toISOString() },
    },
  });
  const updateQualityCheck = (
    key: keyof Pick<ClinicalCaseRecord["acquisition"]["quality"], "focus" | "exposure" | "poseCoverage" | "tracking">,
    value: AcquisitionQualityCheck,
  ) => updateActiveCase({
    acquisition: {
      quality: {
        [key]: value,
        lastCheckedAt: new Date().toISOString(),
      },
    },
  });

  return (
    <Card className="case-acquisition-gate" id="caseAcquisitionGate">
      <CardHeader>
        <span>采集质量门禁</span>
        <RouteStatus className={`case-acquisition-status-${activeCase.acquisition.quality.status}`}>{statusLabel}</RouteStatus>
      </CardHeader>
      <CardContent>
        <div className="case-acquisition-summary">
          <b>{statusLabel}</b>
          <p>{activeCase.acquisition.quality.summary}</p>
        </div>
        <div className="case-capture-grid" aria-label="采集视角完整性">
          {captureViewItems(activeCase.acquisition.source).map((item) => (
            <label key={item.key} className={`case-capture-toggle${item.required ? " is-required" : ""}`}>
              <Checkbox
                checked={activeCase.acquisition.captureSet[item.key]}
                onChange={(event) => updateCaptureSet(item.key, event.currentTarget.checked)}
              />
              <span>
                <b>{item.label}</b>
                <small>{item.required ? "必要" : "可选"} · {item.hint}</small>
              </span>
            </label>
          ))}
        </div>
        <div className="case-quality-grid" aria-label="采集质量检查">
          {qualityChecks.map(([key, label, hint]) => {
            const disabled = key === "tracking" && activeCase.acquisition.source !== "scan3d" && activeCase.acquisition.source !== "realtime";
            return (
              <label key={key} className="case-quality-control">
                <span>
                  <b>{label}</b>
                  <small>{disabled ? "用于 3D 扫描 / 实时模式" : hint}</small>
                </span>
                <Select
                  disabled={disabled}
                  value={activeCase.acquisition.quality[key]}
                  onChange={(event) => updateQualityCheck(key, event.target.value as AcquisitionQualityCheck)}
                >
                  <option value="unchecked">未检查</option>
                  <option value="pass">通过</option>
                  <option value="review">需复核</option>
                </Select>
              </label>
            );
          })}
        </div>
        <Hint>该状态不会锁死医生流程；如果继续操作，候选规则记录、方案确认和导出会保留当前采集质量状态。</Hint>
      </CardContent>
    </Card>
  );
}

function LesionBoundaryPanel({ activeCase }: { activeCase: ClinicalCaseRecord }) {
  const updateActiveCase = useCaseStore((state) => state.updateActiveCase);
  const boundary = activeCase.lesion.boundary;
  const updateBoundary = (boundaryDraft: Partial<ClinicalCaseRecord["lesion"]["boundary"]>) => {
    const nextBoundary = deriveLesionBoundary(activeCase.lesion.layer, activeCase.lesion.diameterMm, {
      ...boundary,
      ...boundaryDraft,
      updatedAt: new Date().toISOString(),
    });
    updateActiveCase({
      lesion: {
        boundary: nextBoundary,
      },
    });
  };
  const axesDisabled = boundary.mode === "center_diameter";
  const freehandDisabled = boundary.mode !== "freehand";

  return (
    <Card className="case-lesion-boundary-panel" id="caseLesionBoundaryPanel">
      <CardHeader>
        <span>病灶边界记录</span>
        <RouteStatus className={`case-lesion-boundary-status-${boundary.status}`}>{lesionBoundaryStatusLabel(boundary.status)}</RouteStatus>
      </CardHeader>
      <CardContent>
        <div className="case-boundary-summary">
          <b>{lesionBoundaryModeLabel(boundary.mode)} · {lesionBoundarySourceLabel(boundary.source)}</b>
          <p>{boundary.summary}</p>
        </div>
        <div className="case-boundary-grid">
          <label className="case-boundary-control">
            <span>
              <b>边界模式</b>
              <small>{activeCase.lesion.layer === "cutaneous" ? "皮表病灶建议记录椭圆或自由轮廓。" : "皮下病灶记录表面投影类圆直径。"}</small>
            </span>
            <Select
              id="lesionBoundaryMode"
              value={boundary.mode}
              onChange={(event) => updateBoundary({ mode: event.target.value as LesionBoundaryMode })}
            >
              <option value="center_diameter">中心点 + 直径</option>
              <option value="ellipse">椭圆边界</option>
              <option value="freehand">自由轮廓点</option>
            </Select>
          </label>
          <label className="case-boundary-control">
            <span>
              <b>来源</b>
              <small>记录病灶尺寸和边界的来源。</small>
            </span>
            <Select
              id="lesionBoundarySource"
              value={boundary.source}
              onChange={(event) => updateBoundary({ source: event.target.value as LesionBoundarySource })}
            >
              <option value="clinical_exam">临床查体</option>
              <option value="photo_trace">照片描记</option>
              <option value="ultrasound">术前超声</option>
              <option value="imported">导入记录</option>
            </Select>
          </label>
          <label className="case-boundary-control">
            <span>
              <b>记录者</b>
              <small>用于审阅和导出追溯。</small>
            </span>
            <Input
              id="lesionBoundaryAuthor"
              value={boundary.author}
              onChange={(event) => updateBoundary({ author: event.target.value })}
              placeholder="记录医生 / 操作者"
            />
          </label>
          <label className="case-boundary-control">
            <span>
              <b>自由轮廓点</b>
              <small>自由描记建议不少于 6 个点。</small>
            </span>
            <Input
              className="clinical-number"
              disabled={freehandDisabled}
              inputMode="numeric"
              min={0}
              type="number"
              value={boundary.pointCount || ""}
              onChange={(event) => updateBoundary({ pointCount: parseOptionalNumber(event.target.value) ?? 0 })}
            />
          </label>
        </div>
        <div className="case-boundary-metrics">
          <label>
            <span>边界长轴 mm</span>
            <Input
              className="clinical-number"
              disabled={axesDisabled}
              inputMode="decimal"
              type="number"
              value={boundary.axisDiameterMm ?? ""}
              onChange={(event) => updateBoundary({ axisDiameterMm: parseOptionalNumber(event.target.value) })}
            />
          </label>
          <label>
            <span>边界短轴 mm</span>
            <Input
              className="clinical-number"
              disabled={axesDisabled}
              inputMode="decimal"
              type="number"
              value={boundary.perpendicularDiameterMm ?? ""}
              onChange={(event) => updateBoundary({ perpendicularDiameterMm: parseOptionalNumber(event.target.value) })}
            />
          </label>
          <div>
            <span>有效宽度</span>
            <b className="clinical-number">{effectiveLesionDiameter(activeCase) ?? "未填"} mm</b>
          </div>
        </div>
        <Hint>完整自由绘图仍可从受控规划入口进入；病例页先保存边界摘要，保证候选、审阅和导出可追溯。</Hint>
      </CardContent>
    </Card>
  );
}

function AcquisitionPathwayPanel({ activeCase }: { activeCase: ClinicalCaseRecord }) {
  const updateActiveCase = useCaseStore((state) => state.updateActiveCase);
  const selectSource = (source: ClinicalCaseRecord["acquisition"]["source"]) => {
    updateActiveCase({
      acquisition: {
        source,
        quality: { lastCheckedAt: new Date().toISOString() },
      },
    });
  };

  return (
    <Card className="case-acquisition-path-panel" id="caseAcquisitionPathPanel">
      <CardHeader>
        <span>图像与视频流采集</span>
        <RouteStatus className={`case-acquisition-status-${activeCase.acquisition.quality.status}`}>
          {activeCase.acquisition.sourceLabel}
        </RouteStatus>
      </CardHeader>
      <CardContent>
        <div className="case-acquisition-path-grid" role="list" aria-label="采集路径">
          {acquisitionPathwayItems().map((item) => {
            const isActive = activeCase.acquisition.source === item.source;
            const Icon = item.Icon;
            return (
              <button
                key={item.source}
                type="button"
                className={`case-acquisition-path-card${isActive ? " is-active" : ""}`}
                aria-pressed={isActive}
                onClick={() => selectSource(item.source)}
              >
                <span className="case-acquisition-path-icon" aria-hidden="true"><Icon size={17} /></span>
                <span className="case-acquisition-path-copy">
                  <b>{item.title}</b>
                  <strong>{item.subtitle}</strong>
                  <small>{item.description}</small>
                </span>
                <span className="case-acquisition-path-meta">
                  <span><b>必要视角</b><em>{item.views}</em></span>
                  <span><b>权限</b><em>{item.permission}</em></span>
                  <span><b>输出</b><em>{item.output}</em></span>
                </span>
                <span className={`case-acquisition-path-state${isActive ? " is-active" : ""}`}>
                  {acquisitionPathwayStateLabel(activeCase, item.source)}
                </span>
              </button>
            );
          })}
        </div>
        <Hint>设备权限在评估采集画布中申请；病例页只记录采集路径、视角完整性和质量状态，避免把原始影像写入普通审阅导出。</Hint>
      </CardContent>
    </Card>
  );
}

function EvaluateStep({ activeCase }: { activeCase: ClinicalCaseRecord }) {
  const navigate = useNavigate();
  const updateActiveCase = useCaseStore((state) => state.updateActiveCase);

  return (
    <div className="case-workflow-stack case-workflow-stage-stack" id="caseEvaluateStep">
      <div className="case-page-header case-workspace-header">
        <Link to="/cases" className="case-back-link"><ArrowLeft size={16} />病例大厅</Link>
        <StatusBadge>步骤一：面部评估与布线</StatusBadge>
      </div>

      <div className="case-clinical-workspace case-clinical-workspace-evaluate">
        <div className="case-workspace-canvas">
          <CaseClinicalViewport activeCase={activeCase} step="evaluate" />
        </div>

        <aside className="case-workspace-panel" aria-label="面部评估参数">
          <section className="case-section case-step-command case-panel-priority">
            <div>
              <h2>面部评估与张力线映射</h2>
              <p>在同一画布中调整采集方式、RSTL、个性化皮纹和透明度；参数变化应直接反馈到左侧面部模型。</p>
            </div>
            <div className="case-panel-action-row">
              <Button
                type="button"
                variant="workbench"
                onClick={() => updateActiveCase({
                  acquisition: {
                    source: "realtime",
                    captureSet: { frontal: true, depthOrVideo: true },
                    quality: { lastCheckedAt: new Date().toISOString() },
                  },
                })}
              >
                切换实时叠加
              </Button>
              <Button variant="workbenchPrimary" onClick={() => {
                updateActiveCase({ currentStep: "plan" });
                navigate(stepHref(activeCase.id, "plan"));
              }}>
                {activeCase.acquisition.quality.status === "ready" ? "下一步：标记病灶" : "继续并标记复核"}
              </Button>
            </div>
          </section>

          <Card>
            <CardHeader><span>患者年龄</span><span>{activeCase.patientContext.ageBandLabel}</span></CardHeader>
            <CardContent>
              <Label htmlFor="caseAge">年龄</Label>
              <Input
                id="caseAge"
                className="clinical-number"
                inputMode="numeric"
                min={0}
                type="number"
                value={activeCase.patientContext.ageYears ?? ""}
                onChange={(event) => updateActiveCase({ patientContext: { ageYears: parseOptionalNumber(event.target.value) } })}
              />
              <Hint id="ageBandHint">{activeCase.patientContext.parameterHint}</Hint>
            </CardContent>
          </Card>

          <AcquisitionPathwayPanel activeCase={activeCase} />

          <Card className="case-layer-board">
            <CardHeader><span>图层看板</span><span>实时反馈</span></CardHeader>
            <CardContent className="case-layer-board-content">
              <div className="case-layer-grid">
                {[
                  ["rstl", "RSTL", "基础张力线投射"],
                  ["personalizedWrinkles", "个性化皮纹", "自然褶皱和凹陷"],
                  ["blendedField", "混合场", "方向融合调优"],
                  ["incisionDesign", "切口设计", "候选线和控制点"],
                ].map(([key, label, hint]) => (
                  <label key={key} className="case-layer-toggle">
                    <Checkbox
                      checked={Boolean(activeCase.layers[key as keyof ClinicalCaseRecord["layers"]])}
                      onChange={(event) => updateActiveCase({
                        layers: { [key]: event.currentTarget.checked } as Partial<ClinicalCaseRecord["layers"]>,
                      })}
                    />
                    <span>
                      <b>{label}</b>
                      <small>{hint}</small>
                    </span>
                  </label>
                ))}
              </div>
              <div className="case-layer-controls" aria-label="图层参数">
                <label className="case-layer-control">
                  <span>
                    <b>RSTL 密度</b>
                    <small>线数量</small>
                  </span>
                  <Select
                    value={activeCase.layers.rstlDensity}
                    onChange={(event) => updateActiveCase({
                      layers: { rstlDensity: event.target.value as ClinicalCaseRecord["layers"]["rstlDensity"] },
                    })}
                  >
                    <option value="low">低密度</option>
                    <option value="standard">标准密度</option>
                    <option value="high">高密度</option>
                  </Select>
                </label>
                <label className="case-layer-control">
                  <span>
                    <b>RSTL 透明度</b>
                    <small className="clinical-number">{percentLabel(activeCase.layers.rstlOpacity)}</small>
                  </span>
                  <input
                    className="case-layer-range"
                    disabled={!activeCase.layers.rstl}
                    max="1"
                    min="0.2"
                    step="0.05"
                    type="range"
                    value={activeCase.layers.rstlOpacity}
                    onChange={(event) => updateActiveCase({
                      layers: { rstlOpacity: Number(event.currentTarget.value) },
                    })}
                  />
                </label>
                <label className="case-layer-control">
                  <span>
                    <b>皮纹透明度</b>
                    <small className="clinical-number">{percentLabel(activeCase.layers.wrinkleOpacity)}</small>
                  </span>
                  <input
                    className="case-layer-range"
                    disabled={!activeCase.layers.personalizedWrinkles}
                    max="1"
                    min="0.2"
                    step="0.05"
                    type="range"
                    value={activeCase.layers.wrinkleOpacity}
                    onChange={(event) => updateActiveCase({
                      layers: { wrinkleOpacity: Number(event.currentTarget.value) },
                    })}
                  />
                </label>
              </div>
            </CardContent>
          </Card>

          <details className="case-disclosure case-clinical-disclosure">
            <summary>采集质量复核 · {acquisitionStatusLabel(activeCase.acquisition.quality.status)}</summary>
            <div className="case-disclosure-body">
              <AcquisitionQualityGate activeCase={activeCase} />
            </div>
          </details>

          {activeCase.acquisition.quality.status !== "ready" ? (
            <Hint>当前采集质量为“{acquisitionStatusLabel(activeCase.acquisition.quality.status)}”。可以继续，但后续候选和导出会标记为需医生复核。</Hint>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function PlanStep({ activeCase }: { activeCase: ClinicalCaseRecord }) {
  const navigate = useNavigate();
  const updateActiveCase = useCaseStore((state) => state.updateActiveCase);
  const closure = activeCase.closureSimulation;
  const closureScore = closure.score ?? 0;
  const closureStyle = { "--case-closure-score": `${closureScore}%` } as CSSProperties;
  const updateLesion = (lesionDraft: Partial<ClinicalCaseRecord["lesion"]>) => {
    const nextLayer = lesionDraft.layer ?? activeCase.lesion.layer;
    const hasDiameterDraft = Object.prototype.hasOwnProperty.call(lesionDraft, "diameterMm");
    const nextDiameter = hasDiameterDraft ? lesionDraft.diameterMm ?? null : activeCase.lesion.diameterMm;
    updateActiveCase({
      lesion: {
        ...lesionDraft,
        layerLabel: lesionLayerLabel(nextLayer),
        boundary: deriveLesionBoundary(nextLayer, nextDiameter, activeCase.lesion.boundary),
      },
    });
  };
  const runClosureSimulation = () => {
    updateActiveCase({ closureSimulation: estimateClosureSimulation(activeCase) });
  };
  const saveCandidateDraft = () => {
    const candidate = buildCaseCandidate(activeCase);
    if (!candidate) return;
    updateActiveCase({
      incisionCandidates: [
        {
          ...candidate,
          status: "selected",
        },
        ...activeCase.incisionCandidates.map((item) => (
          item.id === activeCase.selectedCandidateId ? { ...item, status: "needs_review" as const } : item
        )),
      ],
      selectedCandidateId: candidate.id,
      status: "needs_review",
    });
  };
  const selectCandidate = (candidateId: string) => {
    updateActiveCase({
      incisionCandidates: activeCase.incisionCandidates.map((candidate) => ({
        ...candidate,
        status: candidate.id === candidateId ? "selected" : "needs_review",
      })),
      selectedCandidateId: candidateId,
      status: "needs_review",
    });
  };

  return (
    <div className="case-workflow-stack case-workflow-stage-stack" id="casePlanStep">
      <div className="case-page-header case-workspace-header">
        <Link to={stepHref(activeCase.id, "evaluate")} className="case-back-link"><ArrowLeft size={16} />返回面部评估</Link>
        <StatusBadge>步骤二：病灶定位与切口规划</StatusBadge>
      </div>

      <div className="case-clinical-workspace case-clinical-workspace-plan">
        <div className="case-workspace-canvas">
          <CaseClinicalViewport activeCase={activeCase} step="plan" />
        </div>

        <aside className="case-workspace-panel" aria-label="切口规划参数">
          <section className="case-section case-step-command case-panel-priority">
            <div>
              <h2>病灶定位与切口规划</h2>
              <p>在同一工作区记录病灶边界、切缘策略、候选切口和张力闭合趋势，避免医生在表单和画布之间跳转。</p>
            </div>
            <div className="case-panel-action-row case-panel-action-row-three">
              <Button type="button" variant="workbench" onClick={saveCandidateDraft}>
                保存候选
              </Button>
              <Button type="button" variant="workbench" onClick={runClosureSimulation}>
                <Activity size={16} />张力模拟
              </Button>
              <Button variant="workbenchPrimary" onClick={() => {
                updateActiveCase({ currentStep: "review", status: "needs_review" });
                navigate(stepHref(activeCase.id, "review"));
              }}>
                方案确认
              </Button>
            </div>
            <PlanningRationaleSummary activeCase={activeCase} />
          </section>

          <div className="case-two-column case-panel-two-column">
            <Card>
              <CardHeader><span>病灶参数</span><span>{activeCase.lesion.layerLabel}</span></CardHeader>
              <CardContent>
                <Label htmlFor="lesionLayer">解剖层次</Label>
                <Select
                  id="lesionLayer"
                  value={activeCase.lesion.layer}
                  onChange={(event) => updateLesion({ layer: event.target.value as ClinicalCaseRecord["lesion"]["layer"] })}
                >
                  <option value="subcutaneous">皮下肿物 · 线性切口模式</option>
                  <option value="cutaneous">皮表肿物 · 梭形切口模式</option>
                </Select>

                <div className="case-form-grid">
                  <label>
                    <span>直径 mm</span>
                    <Input
                      className="clinical-number"
                      inputMode="decimal"
                      type="number"
                      value={activeCase.lesion.diameterMm ?? ""}
                      onChange={(event) => updateLesion({ diameterMm: parseOptionalNumber(event.target.value) })}
                    />
                  </label>
                  <label>
                    <span>深度 mm</span>
                    <Input
                      className="clinical-number"
                      inputMode="decimal"
                      type="number"
                      value={activeCase.lesion.depthMm ?? ""}
                      onChange={(event) => updateLesion({ depthMm: parseOptionalNumber(event.target.value) })}
                    />
                  </label>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><span>切缘策略</span><span>{activeCase.lesion.marginStrategy === "expanded_margin" ? "需扩大" : "常规"}</span></CardHeader>
              <CardContent>
                <Label htmlFor="marginStrategy">策略</Label>
                <Select
                  id="marginStrategy"
                  value={activeCase.lesion.marginStrategy}
                  onChange={(event) => updateLesion({ marginStrategy: event.target.value as ClinicalCaseRecord["lesion"]["marginStrategy"] })}
                >
                  <option value="complete_excision">常规完整切除</option>
                  <option value="expanded_margin">需扩大安全切缘</option>
                </Select>
                <Label htmlFor="safetyMargin">安全切缘 mm</Label>
                <Input
                  id="safetyMargin"
                  className="clinical-number"
                  disabled={activeCase.lesion.marginStrategy !== "expanded_margin"}
                  inputMode="decimal"
                  type="number"
                  value={activeCase.lesion.safetyMarginMm ?? ""}
                  onChange={(event) => updateLesion({ safetyMarginMm: parseOptionalNumber(event.target.value) })}
                />
                <Hint>良恶性由医生判断；系统只记录切缘策略并影响规则提示。</Hint>
              </CardContent>
            </Card>
          </div>

          <LesionBoundaryPanel activeCase={activeCase} />

          <CaseCandidateQueue
            activeCase={activeCase}
            onGenerate={saveCandidateDraft}
            onSelect={selectCandidate}
          />

          <Card className="case-closure-simulation" id="caseClosureSimulation">
            <CardHeader>
              <span>张力闭合模拟</span>
              <RouteStatus className={`case-closure-status case-closure-status-${closure.status}`}>{closureStatusLabel(closure.status)}</RouteStatus>
            </CardHeader>
            <CardContent className="case-closure-grid">
              <div className="case-closure-visual" aria-hidden="true">
                <span className="case-closure-face" />
                <span className="case-closure-rstl" />
                <span className="case-closure-cut" />
                <span className="case-closure-pull case-closure-pull-left" />
                <span className="case-closure-pull case-closure-pull-right" />
              </div>
              <div className="case-closure-copy">
                <div className="case-closure-metrics">
                  <div><span>闭合评分</span><b className="clinical-number">{closure.score == null ? "未运行" : `${closure.score} / 100`}</b></div>
                  <div><span>当前结论</span><b>{closure.label}</b></div>
                  <div><span>输入宽度</span><b className="clinical-number">{effectiveLesionDiameter(activeCase) ?? "未填"} mm</b></div>
                  <div><span>更新</span><b className="clinical-number">{closure.lastRunAt ? new Date(closure.lastRunAt).toLocaleString() : "未运行"}</b></div>
                </div>
                <div className="case-closure-meter" style={closureStyle} aria-label="闭合评分">
                  <span />
                </div>
                <Hint>{closure.summary}</Hint>
                <div className="case-inline-actions">
                  <Button variant="workbenchPrimary" type="button" onClick={runClosureSimulation}>
                    <Activity size={16} />运行闭合模拟
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <details className="case-disclosure case-clinical-disclosure">
            <summary>推荐依据与审计记录</summary>
            <div className="case-disclosure-body">
              <PlanningRationalePanel activeCase={activeCase} />
              <Hint>完整几何细调后续应接入当前病例画布；旧切口规划工作台只从“系统设置 - 开发者诊断”进入，避免主流程跳回旧设计模式。</Hint>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}

function ReviewStep({ activeCase }: { activeCase: ClinicalCaseRecord }) {
  const updateActiveCase = useCaseStore((state) => state.updateActiveCase);
  const selectedCandidate = activeCase.incisionCandidates.find((candidate) => candidate.id === activeCase.selectedCandidateId) ?? null;
  const exportStem = safeExportFilePart(activeCase.id);
  const reviewRecord = activeCase.reviewRecord;
  const buildExportedCase = () => {
    const exportedAt = new Date().toISOString();
    return {
      exportedAt,
      record: {
        ...activeCase,
        status: "exported" as const,
        currentStep: "review" as const,
        reviewRecord: {
          ...activeCase.reviewRecord,
          exportedAt,
        },
      },
    };
  };
  const updateReviewRecord = (reviewDraft: Partial<ClinicalCaseRecord["reviewRecord"]>) => {
    updateActiveCase({ reviewRecord: reviewDraft });
  };
  const markReviewDecision = (decision: ClinicalCaseRecord["reviewRecord"]["decision"]) => {
    const reviewedAt = new Date().toISOString();
    updateActiveCase({
      status: decision === "approved" ? "confirmed" : "needs_review",
      currentStep: "review",
      reviewRecord: { decision, reviewedAt },
    });
  };
  const exportReviewJson = () => {
    const exported = buildExportedCase();
    downloadTextFile(
      `${exportStem}-review-export.json`,
      JSON.stringify(buildCaseReviewExport(exported.record, selectedCandidate), null, 2),
      "application/json;charset=utf-8",
    );
    updateActiveCase({ status: "exported", currentStep: "review", reviewRecord: { exportedAt: exported.exportedAt } });
  };
  const exportReportDraft = () => {
    const exported = buildExportedCase();
    downloadTextFile(
      `${exportStem}-report-draft.md`,
      buildCaseReportDraft(exported.record, selectedCandidate),
      "text/markdown;charset=utf-8",
    );
    updateActiveCase({ status: "exported", currentStep: "review", reviewRecord: { exportedAt: exported.exportedAt } });
  };

  return (
    <div className="case-workflow-stack case-workflow-stage-stack" id="caseReviewStep">
      <div className="case-page-header case-workspace-header">
        <Link to={stepHref(activeCase.id, "plan")} className="case-back-link"><ArrowLeft size={16} />返回切口规划</Link>
        <StatusBadge>步骤三：方案确认与输出</StatusBadge>
      </div>

      <div className="case-clinical-workspace case-clinical-workspace-review">
        <div className="case-workspace-canvas">
          <CaseClinicalViewport activeCase={activeCase} step="review" />
        </div>

        <aside className="case-workspace-panel" aria-label="方案确认与输出">
          <section className="case-section case-step-command case-panel-priority">
            <div>
              <h2>方案确认与输出</h2>
              <p>确认最终参数、审计边界、导出入口和临床合规提示。导出不等于正式病例保存。</p>
            </div>
            <div className="case-panel-action-row">
              <Button type="button" variant="workbenchPrimary" onClick={() => markReviewDecision("approved")}>
                标记为已确认
              </Button>
              <Button type="button" variant="workbench" onClick={exportReportDraft}>
                <FileText size={16} />下载报告草案
              </Button>
            </div>
          </section>

          <section className="case-review-compliance-strip" aria-label="确认页合规提示">
            <p><ShieldAlert size={13} /><span>辅助设计，不替代执业医师结合查体确认。</span></p>
            <p><ShieldAlert size={13} /><span>需确认可直接拉拢缝合；皮瓣 / 植皮病例仅作方向参考。</span></p>
            <p><ShieldAlert size={13} /><span>恶性病灶安全切缘以病理阴性为最终标准。</span></p>
          </section>

          <Card>
            <CardHeader><span>病例摘要</span><FileText size={16} /></CardHeader>
            <CardContent className="case-summary-list">
              <p><b>年龄分档</b><span>{activeCase.patientContext.ageBandLabel}</span></p>
              <p><b>病灶层次</b><span>{activeCase.lesion.layerLabel}</span></p>
              <p><b>病灶边界</b><span>{lesionBoundaryStatusLabel(activeCase.lesion.boundary.status)} · {lesionBoundaryModeLabel(activeCase.lesion.boundary.mode)}</span></p>
              <p><b>采集方式</b><span>{activeCase.acquisition.sourceLabel}</span></p>
              <p><b>切缘策略</b><span>{activeCase.lesion.marginStrategy === "expanded_margin" ? `扩大 ${activeCase.lesion.safetyMarginMm ?? "未填"} mm` : "常规完整切除"}</span></p>
              <p><b>当前候选</b><span>{selectedCandidate ? `${selectedCandidate.label} · ${candidateKindLabel(selectedCandidate.kind)}` : "尚未保存候选"}</span></p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><span>医生审阅记录</span><RouteStatus>{reviewDecisionLabel(reviewRecord.decision)}</RouteStatus></CardHeader>
            <CardContent className="case-review-record">
              <Label htmlFor="caseReviewerName">审阅医生</Label>
              <Input
                id="caseReviewerName"
                value={reviewRecord.reviewerName}
                onChange={(event) => updateReviewRecord({ reviewerName: event.currentTarget.value })}
                placeholder="填写执业医师或审阅人"
              />
              <Label htmlFor="caseReviewDecision">审阅结论</Label>
              <Select
                id="caseReviewDecision"
                value={reviewRecord.decision}
                onChange={(event) => updateReviewRecord({
                  decision: event.currentTarget.value as ClinicalCaseRecord["reviewRecord"]["decision"],
                })}
              >
                <option value="pending">待审阅</option>
                <option value="approved">确认采用</option>
                <option value="needs_revision">退回修改</option>
                <option value="rejected">不采用</option>
              </Select>
              <label className="case-review-textarea">
                <span>审阅备注</span>
                <textarea
                  value={reviewRecord.note}
                  onChange={(event) => updateReviewRecord({ note: event.currentTarget.value })}
                  placeholder="记录查体、图像质量、候选取舍或医生补充意见。"
                />
              </label>
              <label className="case-review-textarea">
                <span>覆盖 / 退回原因</span>
                <textarea
                  value={reviewRecord.overrideReason}
                  onChange={(event) => updateReviewRecord({ overrideReason: event.currentTarget.value })}
                  placeholder="高风险提示、扩大切缘、退回修改或人工覆盖时填写原因。"
                />
              </label>
              <div className="case-export-actions" aria-label="审阅结论">
                <Button type="button" variant="workbenchPrimary" onClick={() => markReviewDecision("approved")}>
                  确认采用
                </Button>
                <Button type="button" variant="workbench" onClick={() => markReviewDecision("needs_revision")}>
                  退回修改
                </Button>
                <Button type="button" variant="workbench" onClick={() => markReviewDecision("rejected")}>
                  标记不采用
                </Button>
              </div>
              <div className="case-export-privacy">
                <p><b>审阅时间</b><span className="clinical-number">{reviewRecord.reviewedAt ? new Date(reviewRecord.reviewedAt).toLocaleString() : "未确认"}</span></p>
                <p><b>输出时间</b><span className="clinical-number">{reviewRecord.exportedAt ? new Date(reviewRecord.exportedAt).toLocaleString() : "未导出"}</span></p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><span>保存与导出</span><Save size={16} /></CardHeader>
            <CardContent className="case-review-output">
              <Hint>当前病例草稿会自动保存到本设备。后续接入院内或云端病例库后，可沿用同一入口恢复结构化病例记录。</Hint>
              <div className="case-export-actions" aria-label="本地导出">
                <Button type="button" variant="workbenchPrimary" onClick={exportReportDraft}>
                  <FileText size={16} />下载报告草案
                </Button>
                <Button type="button" variant="workbench" onClick={exportReviewJson}>
                  <Download size={16} />导出脱敏 JSON
                </Button>
              </div>
              <div className="case-export-privacy">
                <p><b>导出内容</b><span>病例参数、候选摘要、审阅记录、规则记录、闭合模拟和合规提示。</span></p>
                <p><b>隐私边界</b><span>不包含原始照片、视频帧、画布像素、3D 纹理或 Provider 密钥。</span></p>
              </div>
              <CaseHandoffPanel
                eyebrow="受控导出入口"
                title="候选方案审阅与导出"
                description="导出前先确认病例摘要、风险提示、审阅记录和合规声明。旧候选工作台不再从医生确认页直跳，避免审阅阶段回到上一代工具界面。"
                items={[
                  { label: "导出前", value: "确认参数、截图、医生备注和覆盖原因" },
                  { label: "导出后", value: "报告只是输出文件，不替代正式病例保存" },
                ]}
              />
            </CardContent>
          </Card>

          <CaseCandidateQueue activeCase={activeCase} readonly />

          <Card>
            <CardHeader><span>临床合规提示</span><ShieldAlert size={16} /></CardHeader>
            <CardContent>
              <Hint>本系统为临床辅助设计工具，不替代医生的专业判断，所有手术方案需由执业医师结合临床查体最终确认。</Hint>
              <Hint>系统默认适应证为可直接拉拢缝合的皮肤 / 皮下肿物；需皮瓣 / 植皮修复的病例，仅作切口方向参考。</Hint>
              <Hint>恶性病灶的安全切缘需以病理检查结果为最终标准。</Hint>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function MissingCase() {
  return (
    <ReactPage className="grid place-items-center p-6">
      <Card className="max-w-[520px]">
        <CardHeader><span>未找到病例</span><span>草稿</span></CardHeader>
        <CardContent>
          <Hint>该病例草稿不存在或本地存储已被清理。请返回病例大厅重新创建。</Hint>
          <Button asChild variant="workbenchPrimary"><Link to="/cases">返回病例大厅</Link></Button>
        </CardContent>
      </Card>
    </ReactPage>
  );
}

function CaseNewSetupRoute() {
  const navigate = useNavigate();
  const createCase = useCaseStore((state) => state.createCase);
  const [title, setTitle] = useState("新建面部评估");
  const [ageYears, setAgeYears] = useState<number | null>(null);
  const [source, setSource] = useState<ClinicalCaseRecord["acquisition"]["source"]>("upload");
  const [layer, setLayer] = useState<ClinicalCaseRecord["lesion"]["layer"]>("subcutaneous");
  const [marginStrategy, setMarginStrategy] = useState<ClinicalCaseRecord["lesion"]["marginStrategy"]>("complete_excision");
  const [safetyMarginMm, setSafetyMarginMm] = useState<number | null>(5);
  const ageContext = classifyCaseAge(ageYears);
  const selectedPathway = acquisitionPathwayItems().find((item) => item.source === source);
  const createCaseDraft = () => {
    const record = createCase({
      title: title.trim() || "新建面部评估",
      currentStep: "evaluate",
      patientContext: { ageYears },
      lesion: {
        layer,
        marginStrategy,
        safetyMarginMm: marginStrategy === "expanded_margin" ? safetyMarginMm : null,
      },
      acquisition: { source },
    });
    if (record) navigate(stepHref(record.id, "evaluate"), { replace: true });
  };

  return (
    <ReactPage className="case-workflow-page">
      <ReactShell>
        <ReactShellSidebar>
          <WorkbenchBrand
            eyebrow="病例工作台"
            title="面部松弛皮肤张力线智能切口设计系统"
            action={<RouteStatus>新建</RouteStatus>}
          />
          <Card>
            <CardHeader><span>创建前确认</span><span>前置参数</span></CardHeader>
            <CardContent className="case-summary-list">
              <p><b>年龄</b><span>{ageContext.ageBandLabel}</span></p>
              <p><b>采集</b><span>{selectedPathway?.title ?? "上传"} · {selectedPathway?.subtitle ?? "高清照片 / 视频"}</span></p>
              <p><b>病灶</b><span>{lesionLayerLabel(layer)}</span></p>
              <p><b>切缘</b><span>{marginStrategy === "expanded_margin" ? `扩大 ${safetyMarginMm ?? "未填"} mm` : "常规完整切除"}</span></p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><span>系统入口</span><span>设置</span></CardHeader>
            <CardContent>
              <ReactShellNavLink to="/cases"><span>返回病例大厅</span><ArrowLeft size={16} /></ReactShellNavLink>
              <ReactShellNavLink to="/settings/atlas"><span>图谱库管理</span><Layers3 size={16} /></ReactShellNavLink>
            </CardContent>
          </Card>
        </ReactShellSidebar>

        <ReactShellMain className="case-workflow-main">
          <div className="case-workflow-stack case-new-setup" id="caseNewSetup">
            <div className="case-page-header">
              <Link to="/cases" className="case-back-link"><ArrowLeft size={16} />病例大厅</Link>
              <StatusBadge>新建病例：前置参数</StatusBadge>
            </div>

            <section className="case-section case-step-command">
              <div>
                <h2>先录入前置参数，再进入面部评估</h2>
                <p>这里收集会影响评估和切口规划的低频病例参数。创建后仍可返回微调，系统会保留本地草稿。</p>
              </div>
              <CaseTaskStrip
                items={[
                  { index: "01", title: "病例上下文", description: "记录匿名标题和年龄分档。" },
                  { index: "02", title: "采集路径", description: "选择上传、拍照、3D 扫描或实时跟踪。" },
                  { index: "03", title: "规划前提", description: "确认病灶层次、切缘策略和合规边界。" },
                ]}
              />
            </section>

            <div className="case-two-column">
              <Card>
                <CardHeader><span>病例上下文</span><span>{ageContext.ageBandLabel}</span></CardHeader>
                <CardContent>
                  <Label htmlFor="newCaseTitle">病例标题</Label>
                  <Input
                    id="newCaseTitle"
                    value={title}
                    onChange={(event) => setTitle(event.currentTarget.value)}
                    placeholder="匿名病例标题"
                  />
                  <Label htmlFor="newCaseAge">患者年龄</Label>
                  <Input
                    id="newCaseAge"
                    className="clinical-number"
                    inputMode="numeric"
                    min={0}
                    type="number"
                    value={ageYears ?? ""}
                    onChange={(event) => setAgeYears(parseOptionalNumber(event.currentTarget.value))}
                  />
                  <Hint>{ageContext.parameterHint}</Hint>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><span>病灶与切缘前提</span><span>{lesionLayerLabel(layer)}</span></CardHeader>
                <CardContent>
                  <Label htmlFor="newCaseLesionLayer">解剖层次</Label>
                  <Select
                    id="newCaseLesionLayer"
                    value={layer}
                    onChange={(event) => setLayer(event.currentTarget.value as ClinicalCaseRecord["lesion"]["layer"])}
                  >
                    <option value="subcutaneous">皮下肿物 · 线性切口模式</option>
                    <option value="cutaneous">皮表肿物 · 梭形切口模式</option>
                  </Select>
                  <Label htmlFor="newCaseMarginStrategy">切缘策略</Label>
                  <Select
                    id="newCaseMarginStrategy"
                    value={marginStrategy}
                    onChange={(event) => setMarginStrategy(event.currentTarget.value as ClinicalCaseRecord["lesion"]["marginStrategy"])}
                  >
                    <option value="complete_excision">常规完整切除</option>
                    <option value="expanded_margin">需扩大安全切缘</option>
                  </Select>
                  <Label htmlFor="newCaseSafetyMargin">安全切缘 mm</Label>
                  <Input
                    id="newCaseSafetyMargin"
                    className="clinical-number"
                    disabled={marginStrategy !== "expanded_margin"}
                    inputMode="decimal"
                    type="number"
                    value={marginStrategy === "expanded_margin" ? safetyMarginMm ?? "" : ""}
                    onChange={(event) => setSafetyMarginMm(parseOptionalNumber(event.currentTarget.value))}
                  />
                  <Hint>良恶性由医生判断；系统只记录切缘策略并影响后续规则提示。</Hint>
                </CardContent>
              </Card>
            </div>

            <Card className="case-acquisition-path-panel">
              <CardHeader><span>采集路径</span><span>{selectedPathway?.title ?? "上传"}</span></CardHeader>
              <CardContent>
                <div className="case-acquisition-path-grid" role="list" aria-label="新建病例采集路径">
                  {acquisitionPathwayItems().map((item) => {
                    const isActive = source === item.source;
                    const Icon = item.Icon;
                    return (
                      <button
                        key={item.source}
                        type="button"
                        className={`case-acquisition-path-card${isActive ? " is-active" : ""}`}
                        aria-pressed={isActive}
                        onClick={() => setSource(item.source)}
                      >
                        <span className="case-acquisition-path-icon" aria-hidden="true"><Icon size={17} /></span>
                        <span className="case-acquisition-path-copy">
                          <b>{item.title}</b>
                          <strong>{item.subtitle}</strong>
                          <small>{item.description}</small>
                        </span>
                        <span className="case-acquisition-path-meta">
                          <span><b>必要视角</b><em>{item.views}</em></span>
                          <span><b>权限</b><em>{item.permission}</em></span>
                          <span><b>输出</b><em>{item.output}</em></span>
                        </span>
                        <span className={`case-acquisition-path-state${isActive ? " is-active" : ""}`}>
                          {isActive ? "已选择" : "可选择"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <div className="case-dashboard-grid">
              <Card>
                <CardHeader><span>创建后流程</span><ArrowRight size={16} /></CardHeader>
                <CardContent className="case-summary-list">
                  <p><b>进入评估</b><span>根据采集路径进入面部评估与张力线映射。</span></p>
                  <p><b>返回微调</b><span>年龄、采集路径、图层和病灶参数都可在病例内继续修改。</span></p>
                  <p><b>保存边界</b><span>当前只建立本地草稿，不写入正式院内病例库。</span></p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><span>临床边界</span><ShieldAlert size={16} /></CardHeader>
                <CardContent>
                  <Hint>本系统为临床辅助设计工具，不替代医生的专业判断。</Hint>
                  <Hint>真实照片、视频、3D 纹理和超声文件不会进入普通审阅 JSON。</Hint>
                  <Button type="button" variant="workbenchPrimary" onClick={createCaseDraft}>
                    <Plus size={16} />创建病例草稿
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </ReactShellMain>
      </ReactShell>
    </ReactPage>
  );
}

export function CaseWorkflowRoute({ step = "evaluate" }: CaseWorkflowRouteProps) {
  const { caseId } = useParams();
  const activeCase = useCaseStore((state) => state.activeCase);
  const selectCase = useCaseStore((state) => state.selectCase);
  const setStep = useCaseStore((state) => state.setStep);

  useReactRouteLifecycle({
    workspace: "dashboard",
    mountedStatus: "病例向导已就绪",
    unloadedStatus: "病例向导已卸载",
  });

  useEffect(() => {
    if (step !== "new" && caseId) selectCase(caseId);
  }, [caseId, selectCase, step]);

  useEffect(() => {
    if (step !== "new" && activeCase && activeCase.currentStep !== step) setStep(step);
  }, [activeCase, setStep, step]);

  if (step === "new") {
    return <CaseNewSetupRoute />;
  }
  if (!activeCase || (caseId && activeCase.id !== caseId)) return <MissingCase />;

  const currentStep = step as ClinicalCaseStep;
  return (
    <CaseWorkflowShell activeCase={activeCase} step={currentStep}>
      {currentStep === "evaluate" ? <EvaluateStep activeCase={activeCase} /> : null}
      {currentStep === "plan" ? <PlanStep activeCase={activeCase} /> : null}
      {currentStep === "review" ? <ReviewStep activeCase={activeCase} /> : null}
    </CaseWorkflowShell>
  );
}
