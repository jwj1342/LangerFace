import { ArrowLeft, RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "./ui/button";

interface ThreePreviewSidebarProps {
  isReady: boolean;
  onReload: () => void;
}

export function ThreePreviewSidebar({ isReady, onReload }: ThreePreviewSidebarProps) {
  return (
    <aside className="react-shell-sidebar">
      <div className="brand">
        <div className="brand-top">
          <span className="eyebrow">R3F RENDERER BOUNDARY</span>
          <span className="react-route-status">{isReady ? "ready" : "loading"}</span>
        </div>
        <h1>R3F 标准脸预览</h1>
      </div>

      <div className="card">
        <p className="hint">
          这里验证 React Three Fiber / drei 的渲染层接入。当前只承载低频资产加载和相机控制；
          切口工作台的高频拾取与候选线编辑仍由独立 Three.js controller 管理。
        </p>
        <Button asChild>
          <Link to="/"><ArrowLeft size={16} /> 返回 React 入口</Link>
        </Button>
        <Button type="button" onClick={onReload}>
          <RotateCcw size={16} /> 重新加载资产
        </Button>
      </div>
    </aside>
  );
}
