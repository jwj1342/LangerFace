import { ArrowRight, Boxes, Camera, Database, FileText, PenLine, Plus, Scissors, Settings } from "lucide-react";
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  ReactPage,
  ReactShell,
  ReactShellMain,
  ReactShellNavLink,
  ReactShellSidebar,
} from "../components/ReactShell";
import { WorkerStatusPanel } from "../components/WorkerStatusPanel";
import { WorkbenchBrand } from "../components/WorkbenchBrand";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Hint } from "../components/ui/hint";
import { RouteStatus } from "../components/ui/status-badge";
import { useReactRouteLifecycle } from "../hooks/useReactRouteLifecycle";
import { type ClinicalCaseStep } from "../services/dataSource";
import { STATE_BOUNDARY_NOTE, useAppStore } from "../stores/appStore";
import { CASE_STORE_BOUNDARY_NOTE, useCaseStore } from "../stores/caseStore";

function caseStepPath(caseId: string, step: ClinicalCaseStep) {
  return `/case/${caseId}/${step}`;
}

export function DashboardRoute() {
  const navigate = useNavigate();
  const routeStatus = useAppStore((state) => state.routeStatus);
  const cases = useCaseStore((state) => state.cases);
  const createCase = useCaseStore((state) => state.createCase);
  const loadCases = useCaseStore((state) => state.loadCases);

  useReactRouteLifecycle({
    workspace: "dashboard",
    mountedStatus: "病例大厅已就绪",
    unloadedStatus: "病例大厅已卸载",
  });

  useEffect(() => {
    loadCases();
  }, [loadCases]);

  const handleCreateCase = () => {
    const record = createCase();
    if (record) navigate(caseStepPath(record.id, "evaluate"));
  };

  return (
    <ReactPage className="case-workflow-page">
      <ReactShell>
        <ReactShellSidebar>
          <WorkbenchBrand
            eyebrow="病例工作台"
            title="面部松弛皮肤张力线智能切口设计系统"
            action={<RouteStatus>{routeStatus}</RouteStatus>}
          />

          <Card>
            <CardHeader><span>快速开始</span><Database size={16} /></CardHeader>
            <CardContent>
              <Button variant="workbenchPrimary" onClick={handleCreateCase}>
                <Plus size={16} />新建面部评估
              </Button>
              <Hint>从病例开始，按“面部评估 - 标记病灶 - 切口规划 - 方案确认”推进；每一步都会保留本地草稿。</Hint>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><span>系统设置</span><Settings size={16} /></CardHeader>
            <CardContent>
              <ReactShellNavLink to="/settings/atlas">
                <span>图谱库管理</span>
                <PenLine size={16} />
              </ReactShellNavLink>
              <ReactShellNavLink to="/settings/developer">
                <span>开发者诊断</span>
                <Boxes size={16} />
              </ReactShellNavLink>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><span>兼容工具入口</span><span>隐藏主流程</span></CardHeader>
            <CardContent>
              <ReactShellNavLink to="/incision">
                <span>切口 Agent 工作台</span>
                <ArrowRight size={16} />
              </ReactShellNavLink>
              <ReactShellNavLink to="/live">
                <span>实时 Langer 线显示</span>
                <Camera size={16} />
              </ReactShellNavLink>
              <ReactShellNavLink to="/annotate">
                <span>3D 网页标注</span>
                <PenLine size={16} />
              </ReactShellNavLink>
              <ReactShellNavLink to="/three-preview">
                <span>R3F 标准脸预览</span>
                <Boxes size={16} />
              </ReactShellNavLink>
              <ReactShellNavLink to="/surgery">
                <span>沿 RSTL 闭合演示</span>
                <Scissors size={16} />
              </ReactShellNavLink>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><span>状态边界</span><span>低频 UI</span></CardHeader>
            <CardContent>
              <Hint>{STATE_BOUNDARY_NOTE}</Hint>
              <Hint>{CASE_STORE_BOUNDARY_NOTE}</Hint>
            </CardContent>
          </Card>

          <WorkerStatusPanel />
        </ReactShellSidebar>

        <ReactShellMain className="case-workflow-main">
          <div className="case-workflow-stack" id="caseDashboard">
            <section className="case-section">
              <div>
                <h2>病例大厅</h2>
                <p>这里是医生主入口。技术工具被收进设置区，日常使用围绕病例草稿、评估、定位、规划和确认推进。</p>
              </div>
              <Button variant="workbenchPrimary" onClick={handleCreateCase}>
                <Plus size={16} />新建病例
              </Button>
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
                <CardHeader><span>流程</span><ArrowRight size={16} /></CardHeader>
                <CardContent className="case-summary-list">
                  <p><b>1. 面部评估</b><span>上传 / 拍照 / 3D 扫描 / 实时 AR，并控制 RSTL 与个性化皮纹图层。</span></p>
                  <p><b>2. 切口规划</b><span>记录肿物层次、直径、切缘策略，进入切口候选工作台。</span></p>
                  <p><b>3. 方案确认</b><span>查看参数、风险、审计和临床合规提示，再导出报告。</span></p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><span>临床边界</span><span>辅助设计</span></CardHeader>
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
