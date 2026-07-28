import {
  Activity,
  Boxes,
  PenLine,
  Scissors,
  Settings,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";

import {
  ReactPage,
  ReactShell,
  ReactShellMain,
  ReactShellNavLink,
  ReactShellSidebar,
} from "../components/ReactShell";
import { WorkbenchBrand } from "../components/WorkbenchBrand";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Hint } from "../components/ui/hint";
import { RouteStatus } from "../components/ui/status-badge";
import { useReactRouteLifecycle } from "../hooks/useReactRouteLifecycle";
import { useAppStore } from "../stores/appStore";

const TOOLS = [
  {
    title: "实时 2D 张力线",
    description: "摄像头、照片或视频上的 RSTL 实时叠加与微调。",
    to: "/live",
    icon: Activity,
  },
  {
    title: "个性化 RSTL",
    description: "在浏览器本地完成多表情采集、皱纹分割与 V6 微调。",
    href: "/personalized",
    icon: Sparkles,
  },
  {
    title: "切口候选研究工具",
    description: "独立运行的候选生成、编辑和审阅原型；不保存病例记录。",
    to: "/incision",
    icon: Scissors,
  },
] as const;

export function DashboardRoute() {
  const routeStatus = useAppStore((state) => state.routeStatus);

  useReactRouteLifecycle({
    workspace: "dashboard",
    mountedStatus: "研究工具入口已就绪",
    unloadedStatus: "研究工具入口已卸载",
  });

  return (
    <ReactPage>
      <ReactShell>
        <ReactShellSidebar>
          <WorkbenchBrand
            eyebrow="RESEARCH TOOLKIT"
            title="面部皮肤张力线研究工具"
            action={<RouteStatus>{routeStatus}</RouteStatus>}
          />

          <Card>
            <CardHeader><span>主要入口</span><Activity size={16} /></CardHeader>
            <CardContent>
              <Button asChild variant="workbenchPrimary">
                <Link to="/live"><Activity size={16} />打开实时 2D</Link>
              </Button>
              <Button asChild variant="workbench">
                <a href="/personalized"><Sparkles size={16} />开始个性化采集</a>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><span>维护与诊断</span><Settings size={16} /></CardHeader>
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

          <Hint>
            本入口不创建、恢复或保存病例。照片、视频和摄像头画面只由对应工具在当前浏览器会话中处理。
          </Hint>
        </ReactShellSidebar>

        <ReactShellMain className="overflow-auto bg-slate-950 p-6">
          <div className="mx-auto grid w-full max-w-5xl gap-5">
            <section className="rounded-xl border border-slate-700 bg-slate-900 p-6 text-slate-100">
              <span className="text-xs font-bold tracking-[0.18em] text-emerald-300">STATELESS WORKBENCH</span>
              <h2 className="mt-3 text-2xl font-bold">选择一个独立工具开始</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                当前阶段聚焦 2D 张力线显示和浏览器本地个性化。工具之间只传递短期预览数据，不维护病例大厅、患者档案、历史记录或云端病例库。
              </p>
            </section>

            <section className="grid gap-4 md:grid-cols-2" aria-label="研究工具">
              {TOOLS.map(({ title, description, icon: Icon, ...destination }) => (
                <Card key={title}>
                  <CardHeader><span>{title}</span><Icon size={17} /></CardHeader>
                  <CardContent>
                    <Hint>{description}</Hint>
                    <Button asChild variant="workbenchPrimary">
                      {"href" in destination
                        ? <a href={destination.href}>打开工具</a>
                        : <Link to={destination.to}>打开工具</Link>}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </section>
          </div>
        </ReactShellMain>
      </ReactShell>
    </ReactPage>
  );
}
