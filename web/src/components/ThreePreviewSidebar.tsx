import { ArrowLeft, RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { WorkbenchBrand } from "./WorkbenchBrand";

interface ThreePreviewSidebarProps {
  isReady: boolean;
  onReload: () => void;
}

export function ThreePreviewSidebar({ isReady, onReload }: ThreePreviewSidebarProps) {
  return (
    <aside className="react-shell-sidebar">
      <WorkbenchBrand
        eyebrow="R3F RENDERER BOUNDARY"
        title="R3F 标准脸预览"
        action={<span className="react-route-status">{isReady ? "ready" : "loading"}</span>}
      />

      <Card>
        <p className="hint">
          这里验证 React Three Fiber / drei 的渲染层接入。当前只承载低频资产加载和相机控制；
          切口工作台的高频拾取与候选线编辑仍由独立 Three.js controller 管理。
        </p>
        <CardContent>
          <Button asChild>
            <Link to="/"><ArrowLeft size={16} /> 返回 React 入口</Link>
          </Button>
          <Button type="button" onClick={onReload}>
            <RotateCcw size={16} /> 重新加载资产
          </Button>
        </CardContent>
      </Card>
    </aside>
  );
}
