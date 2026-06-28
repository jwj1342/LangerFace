import { ArrowLeft, ArrowRight, CheckCircle2, FileText, Layers3, Save, ShieldAlert, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

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
import { type ClinicalCaseRecord, type ClinicalCaseStep } from "../services/dataSource";
import { CASE_STORE_BOUNDARY_NOTE, useCaseStore } from "../stores/caseStore";

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
  return (
    <Card className="case-stepper" id="caseStepper">
      <CardHeader><span>病例步骤</span><SaveStatusBadge /></CardHeader>
      <CardContent>
        {(["evaluate", "plan", "review"] as ClinicalCaseStep[]).map((item, index) => (
          <ReactShellNavLink
            key={item}
            className={item === step ? "case-step-active" : undefined}
            to={stepHref(activeCase.id, item)}
          >
            <span className="case-step-label">
              <b>{index + 1}. {STEP_LABELS[item]}</b>
              <small>{item === step ? "当前步骤，可保存后继续" : "可返回微调，草稿保留"}</small>
            </span>
            {item === step ? <CheckCircle2 size={16} /> : <ArrowRight size={16} />}
          </ReactShellNavLink>
        ))}
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
              <ReactShellNavLink to="/settings/developer"><span>开发者诊断</span><SlidersHorizontal size={16} /></ReactShellNavLink>
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
    ["RSTL", activeCase.layers.rstl],
    ["皮纹", activeCase.layers.personalizedWrinkles],
    ["混合场", activeCase.layers.blendedField],
    ["切口", activeCase.layers.incisionDesign],
  ] as const;

  return (
    <section className={`case-clinical-viewport case-clinical-viewport-${step}`} aria-label={`${stepLabel}临床画布`}>
      <div className="case-viewport-toolbar">
        <div>
          <span>病例画布</span>
          <b>{stepLabel}</b>
        </div>
        <RouteStatus className="case-viewport-status">本地草稿</RouteStatus>
      </div>
      <div className="case-viewport-body">
        <div className="case-face-preview case-face-preview-large" aria-hidden="true">
          <span className="case-face-outline" />
          <span className="case-face-midline" />
          <span className="case-face-rstl case-face-rstl-a" />
          <span className="case-face-rstl case-face-rstl-b" />
          <span className="case-face-rstl case-face-rstl-c" />
          <span className="case-face-lesion" />
          <span className="case-face-incision" />
          <span className="case-face-zone case-face-zone-eye" />
          <span className="case-face-zone case-face-zone-mouth" />
        </div>
        <div className="case-viewport-readout">
          <div><span>年龄分档</span><b>{activeCase.patientContext.ageBandLabel}</b></div>
          <div><span>病灶层次</span><b>{activeCase.lesion.layerLabel}</b></div>
          <div><span>直径</span><b className="clinical-number">{activeCase.lesion.diameterMm ?? "未填"} mm</b></div>
          <div><span>切缘</span><b className="clinical-number">{marginLabel}</b></div>
        </div>
      </div>
      <div className="case-viewport-layer-strip" aria-label="图层状态">
        {layerItems.map(([label, enabled]) => (
          <span key={label} className={enabled ? "is-on" : undefined}>
            {label}
          </span>
        ))}
      </div>
    </section>
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
            <p>先确认患者年龄、采集方式和图层状态，再进入病灶标记。医生可随时返回本步骤微调图层。</p>
          </div>
          <Button asChild variant="workbenchPrimary"><Link to="/live">打开评估画布</Link></Button>
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

      <Card>
        <CardHeader><span>图层看板</span><span>一键开关</span></CardHeader>
        <CardContent className="case-layer-grid">
          {[
            ["rstl", "RSTL", "密度和透明度由评估工具控制"],
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
        </CardContent>
      </Card>

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
            <p>先记录解剖层次、直径、深度和切缘策略，再进入切口工作台生成候选。</p>
          </div>
          <Button asChild variant="workbenchPrimary"><Link to="/incision">打开规划画布</Link></Button>
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

      <Card>
        <CardHeader><span>规划依据</span><ShieldAlert size={16} /></CardHeader>
        <CardContent className="case-rationale-grid">
          <div><b>年龄参数</b><span>{activeCase.patientContext.parameterHint}</span></div>
          <div><b>切口模式</b><span>{activeCase.lesion.layerLabel}</span></div>
          <div><b>敏感结构提示</b><span>接近眼睑、口唇、鼻翼等警惕区时，需专科医生个性化设计。</span></div>
          <div><b>规则边界</b><span>候选线是临床辅助草案，不是自动手术指令。</span></div>
        </CardContent>
      </Card>

      <div className="case-actions">
        <Button asChild variant="workbench"><Link to="/surgery">在当前病例中查看闭合模拟</Link></Button>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader><span>保存与导出</span><Save size={16} /></CardHeader>
          <CardContent>
            <Hint>当前病例草稿已通过 `CaseDataSource` 保存到本地。接入 Worker API 后，同一组件边界可切换为远端结构化病例保存。</Hint>
            <Button asChild variant="workbench"><Link to="/incision">打开候选方案导出面板</Link></Button>
          </CardContent>
        </Card>
      </div>

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
            <Link to={stepHref(activeCase.id, nextStep(currentStep))}>跳到下一步</Link>
          </Button>
        </div>
      ) : null}
    </CaseWorkflowShell>
  );
}
