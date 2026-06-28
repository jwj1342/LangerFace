import { Activity, ArrowLeft, ArrowRight, CheckCircle2, FileText, Layers3, ListChecks, Save, ShieldAlert, SlidersHorizontal } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ClinicalFacePreview } from "../components/ClinicalFacePreview";
import { ReactPage, ReactShell, ReactShellMain, ReactShellNavLink, ReactShellSidebar } from "../components/ReactShell";
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
import { type CaseIncisionCandidateRecord, type ClinicalCaseRecord, type ClinicalCaseStep } from "../services/dataSource";
import { CASE_STORE_BOUNDARY_NOTE, useCaseStore, type CaseSaveStatus } from "../stores/caseStore";

interface CaseWorkflowRouteProps {
  step?: ClinicalCaseStep | "new";
}

const STEP_LABELS: Record<ClinicalCaseStep, string> = {
  evaluate: "面部评估",
  plan: "切口规划",
  review: "方案确认",
};

function parseOptionalNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nextStep(step: ClinicalCaseStep): ClinicalCaseStep {
  if (step === "evaluate") return "plan";
  if (step === "plan") return "review";
  return "review";
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

function nextStepRailLabel(step: ClinicalCaseStep) {
  if (step === "evaluate") return "继续到病灶标记";
  if (step === "plan") return "继续到方案确认";
  return "继续";
}

function closureStatusLabel(status: ClinicalCaseRecord["closureSimulation"]["status"]) {
  if (status === "stable") return "闭合可行";
  if (status === "needs_review") return "需复核";
  return "待运行";
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

function marginPlanningRule(activeCase: ClinicalCaseRecord) {
  const margin = activeCase.lesion.marginStrategy === "expanded_margin"
    ? Math.max(0, activeCase.lesion.safetyMarginMm ?? 0)
    : 0;
  const diameter = activeCase.lesion.diameterMm ?? null;
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

function formatCandidateMetric(value: number | null, unit = "mm") {
  return value == null ? "待定" : `${value.toFixed(1)} ${unit}`;
}

function buildCaseCandidate(activeCase: ClinicalCaseRecord): CaseIncisionCandidateRecord | null {
  const diameter = activeCase.lesion.diameterMm;
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
    activeCase.lesion.marginStrategy === "expanded_margin"
      ? `安全切缘：${margin} mm`
      : "切缘策略：常规完整切除",
    `图层状态：RSTL ${activeCase.layers.rstl ? `${rstlDensityLabel(activeCase.layers.rstlDensity)} ${percentLabel(activeCase.layers.rstlOpacity)}` : "关闭"}，皮纹 ${activeCase.layers.personalizedWrinkles ? percentLabel(activeCase.layers.wrinkleOpacity) : "关闭"}`,
    kind === "fusiform"
      ? `梭形参数：${tipAngleDeg}° / ${ratio}:1`
      : "线性参数：沿局部 RSTL 方向",
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
  const diameter = activeCase.lesion.diameterMm;
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
        <RouteStatus className="case-viewport-status">本地草稿</RouteStatus>
      </div>
      <div className="case-viewport-body">
        <ClinicalFacePreview large showZones layers={activeCase.layers} mode={activeMode} />
        <div className="case-viewport-readout">
          <div><span>年龄分档</span><b>{activeCase.patientContext.ageBandLabel}</b></div>
          <div><span>病灶层次</span><b>{activeCase.lesion.layerLabel}</b></div>
          <div><span>直径</span><b className="clinical-number">{activeCase.lesion.diameterMm ?? "未填"} mm</b></div>
          <div><span>切缘</span><b className="clinical-number">{marginLabel}</b></div>
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
  to: string;
  actionLabel: string;
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
      <Button asChild variant="workbench">
        <Link to={to}>{actionLabel}</Link>
      </Button>
    </section>
  );
}

function PlanningRationalePanel({ activeCase }: { activeCase: ClinicalCaseRecord }) {
  const ageRule = agePlanningRule(activeCase);
  const lesionRule = lesionPlanningRule(activeCase);
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
          <p><b>规则记录</b><span>候选生成应记录年龄分档、病灶层次、切缘策略、图层状态和医生修改。</span></p>
          <p><b>临床边界</b><span>系统只生成辅助草案，不判断良恶性，不输出自动手术指令。</span></p>
          <p><b>保存边界</b><span>当前为本地病例草稿；正式审阅记录后续进入院内或云端病例库。</span></p>
        </div>
      </CardContent>
    </Card>
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
  const canGenerate = activeCase.lesion.diameterMm != null && activeCase.lesion.diameterMm > 0;

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

function EvaluateStep({ activeCase }: { activeCase: ClinicalCaseRecord }) {
  const navigate = useNavigate();
  const updateActiveCase = useCaseStore((state) => state.updateActiveCase);

  return (
    <div className="case-workflow-stack" id="caseEvaluateStep">
      <div className="case-page-header">
        <Link to="/cases" className="case-back-link"><ArrowLeft size={16} />病例大厅</Link>
        <StatusBadge>步骤一：面部评估与布线</StatusBadge>
      </div>

      <div className="case-step-stage-grid">
        <CaseClinicalViewport activeCase={activeCase} step="evaluate" />
        <section className="case-section case-step-command">
          <div>
            <h2>面部评估与张力线映射</h2>
            <p>先确认患者年龄、采集方式和图层状态，再进入评估画布或病灶标记。医生可随时返回本步骤微调图层。</p>
          </div>
          <CaseTaskStrip
            items={[
              { index: "01", title: "确认前置参数", description: "年龄分档、采集方式和病例草稿状态先完成。" },
              { index: "02", title: "映射张力线", description: "进入采集画布确认基础张力线和个性化皮纹。" },
              { index: "03", title: "进入病灶标记", description: "保留图层设置后进入切口规划阶段。" },
            ]}
          />
        </section>
      </div>

      <div className="case-two-column">
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

        <Card>
          <CardHeader><span>年龄分档规则</span><span>参数提示</span></CardHeader>
          <CardContent className="case-summary-list">
            <p><b>0-17 岁</b><span>儿童 / 紧致：缩小夹角，长轴:短轴 3.5:1。</span></p>
            <p><b>18-59 岁</b><span>中青年 / 普通：基础 30° 和 3:1。</span></p>
            <p><b>60 岁及以上</b><span>老年 / 松弛：增加夹角，长轴:短轴 2.5:1。</span></p>
          </CardContent>
        </Card>
      </div>

      <div className="case-two-column">
        <Card>
          <CardHeader><span>图像采集</span><span>{activeCase.acquisition.sourceLabel}</span></CardHeader>
          <CardContent>
            <Label htmlFor="caseAcquisition">采集方式</Label>
            <Select
              id="caseAcquisition"
              value={activeCase.acquisition.source}
              onChange={(event) => updateActiveCase({ acquisition: { source: event.target.value as ClinicalCaseRecord["acquisition"]["source"] } })}
            >
              <option value="upload">上传照片 / 视频</option>
              <option value="photo">标准位拍照</option>
              <option value="scan3d">3D 扫描</option>
              <option value="realtime">实时 AR 跟踪</option>
            </Select>
            <Hint>多角度序列、标准位拍照、3D 扫描和实时跟踪都应进入同一病例上下文。</Hint>
          </CardContent>
        </Card>
      </div>

      <Card className="case-layer-board">
        <CardHeader><span>图层看板</span><span>开关与参数</span></CardHeader>
        <CardContent className="case-layer-board-content">
          <div className="case-layer-grid">
            {[
              ["rstl", "RSTL", "密度和透明度会同步影响病例画布"],
              ["personalizedWrinkles", "个性化皮纹", "额纹、鱼尾纹、鼻唇沟、睑缘纹等"],
              ["blendedField", "混合场", "RSTL + 个性化纹路调优"],
              ["incisionDesign", "切口设计", "候选线、梭形轮廓和控制点"],
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
                <small>调整基础张力线在画布上的走行数量。</small>
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

      <CaseHandoffPanel
        eyebrow="受控评估入口"
        title="面部评估采集画布"
        description="需要实时追踪、上传序列或调整线密度时进入该画布；完成后返回本病例，继续标记病灶和规划切口。"
        to="/live"
        actionLabel="进入评估采集画布"
        items={[
          { label: "进入前", value: "确认年龄、采集方式和图层开关" },
          { label: "返回后", value: "病例草稿保留，继续病灶标记" },
          { label: "边界", value: "该入口服务当前病例评估，不作为独立工具主流程" },
        ]}
      />

      <div className="case-actions">
        <Button variant="workbenchPrimary" onClick={() => {
          updateActiveCase({ currentStep: "plan" });
          navigate(stepHref(activeCase.id, "plan"));
        }}>
          下一步：标记病灶
        </Button>
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
    <div className="case-workflow-stack" id="casePlanStep">
      <div className="case-page-header">
        <Link to={stepHref(activeCase.id, "evaluate")} className="case-back-link"><ArrowLeft size={16} />返回面部评估</Link>
        <StatusBadge>步骤二：病灶定位与切口规划</StatusBadge>
      </div>

      <div className="case-step-stage-grid">
        <CaseClinicalViewport activeCase={activeCase} step="plan" />
        <section className="case-section case-step-command">
          <div>
            <h2>病灶定位与切口规划</h2>
            <p>先记录解剖层次、直径、深度和切缘策略，再进入规划画布生成候选。</p>
          </div>
          <CaseTaskStrip
            items={[
              { index: "01", title: "标记病灶", description: "记录层次、直径、深度、切缘和来源。" },
              { index: "02", title: "生成候选", description: "根据病灶边界和局部方向生成线性或梭形候选。" },
              { index: "03", title: "闭合模拟", description: "在本病例内查看张力闭合趋势并保存结论。" },
            ]}
          />
        </section>
      </div>

      <div className="case-two-column">
        <Card>
          <CardHeader><span>病灶参数</span><span>{activeCase.lesion.layerLabel}</span></CardHeader>
          <CardContent>
            <Label htmlFor="lesionLayer">解剖层次</Label>
            <Select
              id="lesionLayer"
              value={activeCase.lesion.layer}
              onChange={(event) => updateActiveCase({ lesion: { layer: event.target.value as ClinicalCaseRecord["lesion"]["layer"] } })}
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
                  onChange={(event) => updateActiveCase({ lesion: { diameterMm: parseOptionalNumber(event.target.value) } })}
                />
              </label>
              <label>
                <span>深度 mm</span>
                <Input
                  className="clinical-number"
                  inputMode="decimal"
                  type="number"
                  value={activeCase.lesion.depthMm ?? ""}
                  onChange={(event) => updateActiveCase({ lesion: { depthMm: parseOptionalNumber(event.target.value) } })}
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
              onChange={(event) => updateActiveCase({ lesion: { marginStrategy: event.target.value as ClinicalCaseRecord["lesion"]["marginStrategy"] } })}
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
              onChange={(event) => updateActiveCase({ lesion: { safetyMarginMm: parseOptionalNumber(event.target.value) } })}
            />
            <Hint>良恶性由医生判断；系统只记录切缘策略并影响规则提示。</Hint>
          </CardContent>
        </Card>
      </div>

      <PlanningRationalePanel activeCase={activeCase} />

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
              <div><span>输入宽度</span><b className="clinical-number">{activeCase.lesion.diameterMm ?? "未填"} mm</b></div>
              <div><span>更新</span><b className="clinical-number">{closure.lastRunAt ? new Date(closure.lastRunAt).toLocaleString() : "未运行"}</b></div>
            </div>
            <div className="case-closure-meter" style={closureStyle} aria-label="闭合评分">
              <span />
            </div>
            <Hint>{closure.summary}</Hint>
            <Hint>模拟结果保存在当前病例草稿中；它是闭合趋势提示，不替代医生对皮肤松弛度、张力和修复方式的判断。</Hint>
            <div className="case-inline-actions">
              <Button variant="workbenchPrimary" type="button" onClick={runClosureSimulation}>
                <Activity size={16} />运行闭合模拟
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <CaseHandoffPanel
        eyebrow="受控规划入口"
        title="候选切口规划画布"
        description="需要在面部画布上圈定范围、微调角度或保存多个候选时进入该画布；候选结果应回到本病例中审阅和导出。"
        to="/incision"
        actionLabel="进入候选规划画布"
        items={[
          { label: "进入前", value: "确认病灶层次、直径、深度和切缘策略" },
          { label: "返回后", value: "候选方案进入当前病例的审阅步骤" },
          { label: "闭合模拟", value: "已嵌入本页，不再跳转到独立演示页" },
        ]}
      />

      <div className="case-actions">
        <Button variant="workbenchPrimary" onClick={() => {
          updateActiveCase({ currentStep: "review", status: "needs_review" });
          navigate(stepHref(activeCase.id, "review"));
        }}>
          确认方案并生成报告
        </Button>
      </div>
    </div>
  );
}

function ReviewStep({ activeCase }: { activeCase: ClinicalCaseRecord }) {
  const updateActiveCase = useCaseStore((state) => state.updateActiveCase);
  const selectedCandidate = activeCase.incisionCandidates.find((candidate) => candidate.id === activeCase.selectedCandidateId) ?? null;

  return (
    <div className="case-workflow-stack" id="caseReviewStep">
      <div className="case-page-header">
        <Link to={stepHref(activeCase.id, "plan")} className="case-back-link"><ArrowLeft size={16} />返回切口规划</Link>
        <StatusBadge>步骤三：方案确认与输出</StatusBadge>
      </div>

      <div className="case-step-stage-grid">
        <CaseClinicalViewport activeCase={activeCase} step="review" />
        <section className="case-section case-step-command">
          <div>
            <h2>方案确认与输出</h2>
            <p>确认页展示最终参数、审计边界、导出入口和临床合规提示。导出不等于正式病例保存。</p>
          </div>
          <Button variant="workbenchPrimary" onClick={() => updateActiveCase({ status: "confirmed", currentStep: "review" })}>
            标记为已确认
          </Button>
        </section>
      </div>

      <div className="case-two-column">
        <Card>
          <CardHeader><span>病例摘要</span><FileText size={16} /></CardHeader>
          <CardContent className="case-summary-list">
            <p><b>年龄分档</b><span>{activeCase.patientContext.ageBandLabel}</span></p>
            <p><b>病灶层次</b><span>{activeCase.lesion.layerLabel}</span></p>
            <p><b>采集方式</b><span>{activeCase.acquisition.sourceLabel}</span></p>
            <p><b>切缘策略</b><span>{activeCase.lesion.marginStrategy === "expanded_margin" ? `扩大 ${activeCase.lesion.safetyMarginMm ?? "未填"} mm` : "常规完整切除"}</span></p>
            <p><b>当前候选</b><span>{selectedCandidate ? `${selectedCandidate.label} · ${candidateKindLabel(selectedCandidate.kind)}` : "尚未保存候选"}</span></p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><span>保存与导出</span><Save size={16} /></CardHeader>
          <CardContent>
            <Hint>当前病例草稿会自动保存到本设备。后续接入院内或云端病例库后，可沿用同一入口恢复结构化病例记录。</Hint>
            <CaseHandoffPanel
              eyebrow="受控导出入口"
              title="候选方案审阅与导出"
              description="导出前先确认病例摘要、风险提示和合规声明；需要回到候选画布时，从这里进入审阅与截图导出。"
              to="/incision"
              actionLabel="打开候选审阅与导出"
              items={[
                { label: "导出前", value: "确认参数、截图和医生备注" },
                { label: "导出后", value: "报告只是输出文件，不替代正式病例保存" },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <CaseCandidateQueue activeCase={activeCase} readonly />

      <Card>
        <CardHeader><span>临床合规提示</span><ShieldAlert size={16} /></CardHeader>
        <CardContent>
          <Hint>本系统为临床辅助设计工具，不替代医生的专业判断，所有手术方案需由执业医师结合临床查体最终确认。</Hint>
          <Hint>系统默认适应证为可直接拉拢缝合的皮肤 / 皮下肿物；需皮瓣 / 植皮修复的病例，仅作切口方向参考。</Hint>
          <Hint>恶性病灶的安全切缘需以病理检查结果为最终标准。</Hint>
        </CardContent>
      </Card>
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

export function CaseWorkflowRoute({ step = "evaluate" }: CaseWorkflowRouteProps) {
  const navigate = useNavigate();
  const { caseId } = useParams();
  const activeCase = useCaseStore((state) => state.activeCase);
  const createCase = useCaseStore((state) => state.createCase);
  const selectCase = useCaseStore((state) => state.selectCase);
  const setStep = useCaseStore((state) => state.setStep);

  useReactRouteLifecycle({
    workspace: "dashboard",
    mountedStatus: "病例向导已就绪",
    unloadedStatus: "病例向导已卸载",
  });

  useEffect(() => {
    if (step === "new") {
      const record = createCase();
      if (record) navigate(stepHref(record.id, "evaluate"), { replace: true });
      return;
    }
    if (caseId) selectCase(caseId);
  }, [caseId, createCase, navigate, selectCase, step]);

  useEffect(() => {
    if (step !== "new" && activeCase && activeCase.currentStep !== step) setStep(step);
  }, [activeCase, setStep, step]);

  if (step === "new") {
    return (
      <ReactPage className="grid place-items-center p-6">
        <Card className="max-w-[420px]">
          <CardHeader><span>正在创建病例</span><span>草稿</span></CardHeader>
          <CardContent>
            <Hint>正在建立本地病例工作区。</Hint>
          </CardContent>
        </Card>
      </ReactPage>
    );
  }
  if (!activeCase || (caseId && activeCase.id !== caseId)) return <MissingCase />;

  const currentStep = step as ClinicalCaseStep;
  return (
    <CaseWorkflowShell activeCase={activeCase} step={currentStep}>
      {currentStep === "evaluate" ? <EvaluateStep activeCase={activeCase} /> : null}
      {currentStep === "plan" ? <PlanStep activeCase={activeCase} /> : null}
      {currentStep === "review" ? <ReviewStep activeCase={activeCase} /> : null}
      {currentStep !== "review" ? (
        <div className="case-next-rail">
          <Button asChild variant="workbench">
            <Link to={stepHref(activeCase.id, nextStep(currentStep))}>{nextStepRailLabel(currentStep)}</Link>
          </Button>
        </div>
      ) : null}
    </CaseWorkflowShell>
  );
}
