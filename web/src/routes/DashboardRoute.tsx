import { ArrowRight, Boxes, Camera, ExternalLink, PenLine, Scissors } from "lucide-react";
import { Link } from "react-router-dom";

import { WorkerStatusPanel } from "../components/WorkerStatusPanel";
import { WorkbenchBrand } from "../components/WorkbenchBrand";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Hint } from "../components/ui/hint";
import { RouteStatus } from "../components/ui/status-badge";
import { useReactRouteLifecycle } from "../hooks/useReactRouteLifecycle";
import { STATE_BOUNDARY_NOTE, useAppStore } from "../stores/appStore";

export function DashboardRoute() {
  const routeStatus = useAppStore((state) => state.routeStatus);
  useReactRouteLifecycle({
    workspace: "dashboard",
    mountedStatus: "React 入口已就绪",
    unloadedStatus: "React 入口已卸载",
  });

  return (
    <div className="react-page">
      <div className="react-shell">
        <aside className="react-shell-sidebar">
          <WorkbenchBrand
            eyebrow="REACT ARCHITECTURE"
            title="React 工作台"
            action={<RouteStatus>{routeStatus}</RouteStatus>}
          />

          <Card>
            <Link className="react-nav-link" to="/incision">
              <span>切口 Agent 工作台</span>
              <ArrowRight size={16} />
            </Link>
            <Link className="react-nav-link" to="/live">
              <span>实时 Langer 线显示</span>
              <Camera size={16} />
            </Link>
            <Link className="react-nav-link" to="/annotate">
              <span>3D 网页标注</span>
              <PenLine size={16} />
            </Link>
            <Link className="react-nav-link" to="/three-preview">
              <span>R3F 标准脸预览</span>
              <Boxes size={16} />
            </Link>
            <Link className="react-nav-link" to="/surgery">
              <span>沿 RSTL 闭合演示</span>
              <Scissors size={16} />
            </Link>
            <a className="react-nav-link" href="/index.html">
              <span>旧 HTML 实时入口</span>
              <ExternalLink size={16} />
            </a>
          </Card>

          <Card>
            <CardHeader><span>状态边界</span><span>低频 UI</span></CardHeader>
            <CardContent>
              <Hint>{STATE_BOUNDARY_NOTE}</Hint>
            </CardContent>
          </Card>

          <WorkerStatusPanel />
        </aside>

        <main className="react-shell-main grid place-items-center p-6">
          <div className="max-w-[680px] text-[#dbe4ee]">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#7dd3fc]">SPA Shell</p>
            <h2 className="mt-3 text-3xl font-bold">浏览器端架构重构入口</h2>
            <p className="mt-4 text-sm leading-7 text-[#9aa3b2]">
              当前 PR 分支保留既有确定性 workflow，并把新工作台放入 React Router。
              切口功能先通过生命周期桥迁入，3D 标准脸预览使用 R3F / drei 验证渲染层边界；
              实时显示、3D 标注页和沿 RSTL 闭合演示也开始由 React 路由接管页面 DOM 和 controller 生命周期。
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild variant="primary">
                <Link to="/incision">进入切口工作台</Link>
              </Button>
              <Button asChild>
                <Link to="/live">打开实时显示</Link>
              </Button>
              <Button asChild>
                <Link to="/three-preview">查看 R3F 预览</Link>
              </Button>
              <Button asChild>
                <Link to="/annotate">打开 3D 标注</Link>
              </Button>
              <Button asChild>
                <Link to="/surgery">打开闭合演示</Link>
              </Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
