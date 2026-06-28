import {
  ArrowRight,
  Boxes,
  ClipboardCheck,
  FileText,
  FolderOpen,
  History,
  PenLine,
  Plus,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router-dom";

import { ReactPage, ReactShell, ReactShellMain, ReactShellNavLink, ReactShellSidebar } from "../components/ReactShell";
import { ThreePreviewScene } from "../components/ThreePreviewScene";
import { WorkbenchBrand } from "../components/WorkbenchBrand";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Hint } from "../components/ui/hint";
import { RouteStatus } from "../components/ui/status-badge";
import { useReactRouteLifecycle } from "../hooks/useReactRouteLifecycle";
import { useStandardFaceAssets } from "../hooks/useStandardFaceAssets";
import { type ClinicalCaseStep } from "../services/dataSource";
import { useAppStore } from "../stores/appStore";
import { useCaseStore } from "../stores/caseStore";

function caseStepPath(caseId: string, step: ClinicalCaseStep) {
  return `/case/${caseId}/${step}`;
}

function CaseLobbyStagePreview() {
  const { assets, loadingText } = useStandardFaceAssets({
    failedRouteStatus: "病例大厅三维预览加载失败",
    initialLoadingText: "正在加载病例大厅三维预览",
    loadedAssetStatus: "病例大厅三维预览已加载",
    loadedRouteStatus: "病例大厅已就绪",
    loadingAssetStatus: "病例大厅三维预览加载中",
    loadingRouteStatus: "病例大厅预览加载中",
    progressFallbackLabel: "病例大厅三维预览",
  });

  return (
    <div className="case-lobby-stage" aria-label="临床画布预览">
      <div className="case-stage-topline">
        <span>3D 面部重建</span>
        <b>{assets ? "预览就绪" : "加载中"}</b>
      </div>
      <div className="case-face-asset-frame case-lobby-asset-frame" data-loaded={assets ? "true" : "false"}>
        <ThreePreviewScene assets={assets} loadingText={loadingText} />
        <div className="case-face-clinical-overlay" aria-hidden="true">
          <span className="case-face-overlay-label">病例大厅三维预览</span>
          <span className="case-face-overlay-lesion" />
          <span className="case-face-overlay-incision" />
          <span className="case-face-ruler"><b>10 mm</b></span>
          <span className="case-face-coordinate">R12 / Z05</span>
        </div>
      </div>
      <div className="case-stage-metrics">
        <div><span>RSTL</span><b>就绪</b></div>
        <div><span>皮纹</span><b>待追踪</b></div>
        <div><span>切口</span><b>未生成</b></div>
      </div>
    </div>
  );
}

export function DashboardRoute() {
  const routeStatus = useAppStore((state) => state.routeStatus);
  const cases = useCaseStore((state) => state.cases);
  const loadCases = useCaseStore((state) => state.loadCases);

  useReactRouteLifecycle({
    workspace: "dashboard",
    mountedStatus: "病例大厅已就绪",
    unloadedStatus: "病例大厅已卸载",
  });

  useEffect(() => {
    loadCases();
  }, [loadCases]);

  const latestCase = cases[0] ?? null;

  return (
    <ReactPage className="case-workflow-page">
      <ReactShell>
        <ReactShellSidebar>
          <WorkbenchBrand
            eyebrow="病例工作台"
            title="面部松弛皮肤张力线智能切口设计系统"
            action={<RouteStatus>{routeStatus}</RouteStatus>}
          />

          <Card className="case-primary-action-card">
            <CardHeader><span>快速开始</span><ClipboardCheck size={16} /></CardHeader>
            <CardContent>
              <Button asChild variant="workbenchPrimary">
                <Link to="/case/new"><Plus size={16} />新建面部评估</Link>
              </Button>
              {latestCase ? (
                <Button asChild variant="workbench">
                  <Link to={caseStepPath(latestCase.id, latestCase.currentStep)}>
                    <History size={16} />继续最近病例
                  </Link>
                </Button>
              ) : null}
              <Hint>从病例开始，按“面部评估 - 标记病灶 - 切口规划 - 方案确认”推进；每一步都会保留草稿。</Hint>
            </CardContent>
          </Card>

          <Card className="case-sidebar-status-card">
            <CardHeader><span>工作区状态</span><FolderOpen size={16} /></CardHeader>
            <CardContent className="case-mini-grid">
              <div><span>草稿</span><b className="clinical-number">{cases.length}</b></div>
              <div><span>主流程</span><b>3 步</b></div>
              <div><span>保存</span><b>本地</b></div>
              <div><span>维护入口</span><b>设置</b></div>
            </CardContent>
          </Card>

          <Card className="case-settings-card">
            <CardHeader><span>系统设置</span><Settings size={16} /></CardHeader>
            <CardContent>
              <ReactShellNavLink to="/settings/atlas">
                <span>图谱库管理</span>
                <PenLine size={16} />
              </ReactShellNavLink>
              <ReactShellNavLink to="/settings/developer">
                <span>系统诊断</span>
                <Boxes size={16} />
              </ReactShellNavLink>
            </CardContent>
          </Card>

        </ReactShellSidebar>

        <ReactShellMain className="case-workflow-main">
          <div className="case-workflow-stack" id="caseDashboard">
            <section className="case-lobby-landing" aria-labelledby="caseLobbyTitle">
              <div className="case-lobby-copy">
                <span className="case-lobby-kicker">工作台大厅</span>
                <h2 id="caseLobbyTitle">从病例开始完成面部评估、病灶定位和切口方案确认</h2>
                <p>医生日常入口围绕病例草稿组织；图谱维护、模型配置和系统诊断统一收进系统设置，避免主流程被工具列表打断。</p>
                <div className="case-lobby-actions">
                  <Button asChild variant="workbenchPrimary">
                    <Link to="/case/new"><Plus size={16} />新建病例</Link>
                  </Button>
                  {latestCase ? (
                    <Button asChild variant="workbench">
                      <Link to={caseStepPath(latestCase.id, latestCase.currentStep)}>
                        <History size={16} />继续最近病例
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="case-lobby-readiness" aria-label="工作台状态">
                <div><span>病例草稿</span><b className="clinical-number">{cases.length}</b></div>
                <div><span>流程阶段</span><b>评估 / 规划 / 确认</b></div>
                <div><span>保存反馈</span><b>本地草稿</b></div>
              </div>
              <CaseLobbyStagePreview />
            </section>

            <section className="case-workflow-roadmap" aria-label="临床流程">
              {[
                ["01", "面部评估与布线", "上传、拍照、3D 扫描或实时跟踪，并调整张力线图层。"],
                ["02", "标记病灶参数", "记录年龄分档、病灶层次、直径、深度和切缘策略。"],
                ["03", "切口规划与闭合模拟", "生成候选切口，查看规划依据和张力闭合提示。"],
                ["04", "方案确认与输出", "确认医生审阅状态，导出报告草案和结构化记录。"],
              ].map(([index, title, copy]) => (
                <article key={index} className="case-roadmap-item">
                  <span className="clinical-number">{index}</span>
                  <b>{title}</b>
                  <p>{copy}</p>
                </article>
              ))}
            </section>

            <Card>
              <CardHeader><span>病例草稿</span><span className="clinical-number">{cases.length}</span></CardHeader>
              <CardContent className="case-list" id="caseList">
                {cases.length ? cases.map((item) => (
                  <Link key={item.id} className="case-list-item" to={caseStepPath(item.id, item.currentStep)}>
                    <span>
                      <b>{item.title}</b>
                      <small>{item.patientContext.ageBandLabel} · {item.lesion.layerLabel} · {item.acquisition.sourceLabel}</small>
                    </span>
                    <span className="clinical-number">{new Date(item.updatedAt).toLocaleString()}</span>
                  </Link>
                )) : (
                  <div className="case-empty-state">
                    <FileText size={22} />
                    <p>暂无病例草稿。点击“新建面部评估”开始。</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="case-dashboard-grid">
              <Card>
                <CardHeader><span>任务入口</span><ArrowRight size={16} /></CardHeader>
                <CardContent className="case-summary-list">
                  <p><b>新建病例</b><span>先录入前置参数，再进入面部评估。</span></p>
                  <p><b>恢复草稿</b><span>从病例列表回到上次保存的步骤。</span></p>
                  <p><b>全局设置</b><span>管理图谱库、模型配置和系统诊断入口。</span></p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><span>临床边界</span><ShieldCheck size={16} /></CardHeader>
                <CardContent>
                  <Hint>系统不判断良恶性，不输出自动手术指令。候选方案必须由执业医师结合查体确认。</Hint>
                  <Hint>病例草稿默认本地保存；真实影像、3D 纹理、超声等敏感资产不进入普通审阅 JSON。</Hint>
                </CardContent>
              </Card>
            </div>
          </div>
        </ReactShellMain>
      </ReactShell>
    </ReactPage>
  );
}
