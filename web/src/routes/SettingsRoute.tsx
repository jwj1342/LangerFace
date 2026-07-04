import {
  Activity,
  ArrowLeft,
  Boxes,
  ClipboardCheck,
  Database,
  FileCode2,
  Layers3,
  PenLine,
  Scissors,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { ProviderConfigPanel } from "../components/ProviderConfigPanel";
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
import { RouteStatus, StatusBadge } from "../components/ui/status-badge";
import { useReactRouteLifecycle } from "../hooks/useReactRouteLifecycle";
import { STATE_BOUNDARY_NOTE, useAppStore } from "../stores/appStore";

export interface SettingsRouteProps {
  section: "atlas" | "developer";
}

const SETTINGS_COPY = {
  atlas: {
    id: "settingsAtlas",
    label: "图谱库管理",
    eyebrow: "系统设置",
    status: "图谱维护",
    title: "标准张力线图谱的生产、复核与导出",
    summary: "这里承载 3D 线标注和图谱校验入口。它服务于科研人员和管理员，不进入医生的病例规划主流程。",
  },
  developer: {
    id: "settingsDeveloper",
    label: "开发者诊断",
    eyebrow: "系统设置",
    status: "诊断维护",
    title: "AI 摘要服务、三维资产和运行时诊断",
    summary: "这里集中放置服务连接测试、模型资产预览和兼容工作台入口。医生病例流程只显示临床任务，不直接暴露这些研发工具。",
  },
} satisfies Record<SettingsRouteProps["section"], {
  eyebrow: string;
  id: string;
  label: string;
  status: string;
  summary: string;
  title: string;
}>;

function SettingMetric({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function SettingsSidebar({ section }: SettingsRouteProps) {
  const routeStatus = useAppStore((state) => state.routeStatus);

  return (
    <ReactShellSidebar>
      <WorkbenchBrand
        eyebrow={SETTINGS_COPY[section].eyebrow}
        title="面部松弛皮肤张力线智能切口设计系统"
        action={<RouteStatus>{routeStatus}</RouteStatus>}
      />

      <Card>
        <CardHeader><span>设置导航</span><SlidersHorizontal size={16} /></CardHeader>
        <CardContent>
          <ReactShellNavLink to="/cases">
            <span>返回病例大厅</span>
            <ArrowLeft size={16} />
          </ReactShellNavLink>
          <ReactShellNavLink to="/settings/atlas">
            <span>图谱库管理</span>
            <Layers3 size={16} />
          </ReactShellNavLink>
          <ReactShellNavLink to="/settings/developer">
            <span>开发者诊断</span>
            <ServerCog size={16} />
          </ReactShellNavLink>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><span>主流程边界</span><ShieldCheck size={16} /></CardHeader>
        <CardContent>
          <Hint>医生日常路径保持为“病例大厅 - 面部评估 - 切口规划 - 方案确认”。图谱生产、模型预览和服务诊断只从系统设置进入。</Hint>
          <div className="case-mini-grid settings-mini-grid">
            <SettingMetric label="临床主流程" value="病例" />
            <SettingMetric label="图谱维护" value="设置" />
            <SettingMetric label="服务配置" value="设置" />
            <SettingMetric label="兼容工具" value="受控" />
          </div>
        </CardContent>
      </Card>

      <details className="case-disclosure case-developer-notes">
        <summary>状态边界说明</summary>
        <div className="case-disclosure-body">
          <Hint>{STATE_BOUNDARY_NOTE}</Hint>
        </div>
      </details>
    </ReactShellSidebar>
  );
}

function SettingsHero({ section }: SettingsRouteProps) {
  const copy = SETTINGS_COPY[section];

  return (
    <section className="settings-hero" id={copy.id} aria-labelledby={`${copy.id}Title`}>
      <div>
        <span className="case-lobby-kicker">{copy.label}</span>
        <h2 id={`${copy.id}Title`}>{copy.title}</h2>
        <p>{copy.summary}</p>
      </div>
      <div className="settings-hero-readiness" aria-label="设置页状态">
        <SettingMetric label="入口归属" value="系统设置" />
        <SettingMetric label="医生主流程" value="不显示" />
        <SettingMetric label="路由状态" value={copy.status} />
      </div>
    </section>
  );
}

function AtlasSettings() {
  return (
    <>
      <SettingsHero section="atlas" />
      <section className="settings-panel-grid" aria-label="图谱库管理内容">
        <Card>
          <CardHeader><span>图谱复核工具</span><PenLine size={16} /></CardHeader>
          <CardContent>
            <Hint>打开当前 3D 线标注工具，绘制和复核标准脸上的 RSTL / Langer 线草案。导出的图谱仍需临床校验后才能成为正式参考。</Hint>
            <Button asChild variant="workbenchPrimary">
              <Link to="/annotate"><PenLine size={16} />打开图谱标注工具</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><span>图谱状态</span><ClipboardCheck size={16} /></CardHeader>
          <CardContent className="settings-boundary-list">
            <p><b>当前定位</b><span>生产和复核标准图谱，不直接参与医生病例规划。</span></p>
            <p><b>校验要求</b><span>正式图谱需要记录校验者、拓扑版本、来源和 validated 状态。</span></p>
            <p><b>数据边界</b><span>图谱维护不应混入患者照片、视频或病例报告内容。</span></p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><span>维护清单</span><Database size={16} /></CardHeader>
          <CardContent className="settings-checklist">
            <StatusBadge>拓扑身份校验</StatusBadge>
            <StatusBadge>方向场来源记录</StatusBadge>
            <StatusBadge>医生复核记录</StatusBadge>
            <StatusBadge>导出版本号</StatusBadge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><span>临床入口保护</span><ShieldCheck size={16} /></CardHeader>
          <CardContent>
            <Hint>病例大厅和病例步骤条不直接展示图谱标注工具。需要维护图谱时，从“系统设置 - 图谱库管理”进入，退出后回到病例大厅。</Hint>
            <Button asChild variant="workbench">
              <Link to="/cases"><ArrowLeft size={16} />返回病例大厅</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </>
  );
}

function DeveloperSettings() {
  return (
    <>
      <SettingsHero section="developer" />
      <section className="settings-panel-grid settings-panel-grid-wide" aria-label="开发者诊断内容">
        <div className="settings-provider-panel">
          <ProviderConfigPanel />
        </div>

        <Card>
          <CardHeader><span>三维资产诊断</span><Boxes size={16} /></CardHeader>
          <CardContent>
            <Hint>用于确认标准三维面部模型、图谱资产和浏览器渲染链路是否可用。该入口不作为医生病例规划页面。</Hint>
            <Button asChild variant="workbench">
              <Link to="/three-preview"><Boxes size={16} />打开三维模型预览</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><span>兼容工作台</span><Activity size={16} /></CardHeader>
          <CardContent className="settings-action-list">
            <ReactShellNavLink to="/live"><span>实时张力线旧入口</span><Activity size={16} /></ReactShellNavLink>
            <ReactShellNavLink to="/incision"><span>切口规划旧工作台</span><FileCode2 size={16} /></ReactShellNavLink>
            <ReactShellNavLink to="/surgery"><span>闭合模拟兼容演示</span><Scissors size={16} /></ReactShellNavLink>
          </CardContent>
        </Card>

        <div className="settings-worker-panel">
          <WorkerStatusPanel />
        </div>

        <Card>
          <CardHeader><span>诊断边界</span><ShieldCheck size={16} /></CardHeader>
          <CardContent className="settings-boundary-list">
            <p><b>AI 服务</b><span>只测试浏览器到 OpenAI-compatible / vLLM 服务的连接，不参与确定性切口几何。</span></p>
            <p><b>资产预览</b><span>用于排查模型加载、图谱懒加载和渲染兼容性，不替代病例画布。</span></p>
            <p><b>兼容入口</b><span>保留回归测试价值，但不应重新出现在医生主导航。</span></p>
          </CardContent>
        </Card>
      </section>
    </>
  );
}

export function SettingsRoute({ section }: SettingsRouteProps) {
  useReactRouteLifecycle({
    workspace: "settings",
    mountedStatus: `${SETTINGS_COPY[section].label}已就绪`,
    unloadedStatus: "系统设置已卸载",
  });

  return (
    <ReactPage className="case-workflow-page settings-workbench-page">
      <ReactShell>
        <SettingsSidebar section={section} />
        <ReactShellMain className="case-workflow-main">
          <div className="case-workflow-stack settings-workbench-stack">
            {section === "atlas" ? <AtlasSettings /> : <DeveloperSettings />}
          </div>
        </ReactShellMain>
      </ReactShell>
    </ReactPage>
  );
}
