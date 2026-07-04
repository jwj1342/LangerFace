import { ArrowLeft, RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";

import { ReactShellSidebar } from "./ReactShell";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Hint } from "./ui/hint";
import { RouteStatus } from "./ui/status-badge";
import { WorkbenchBrand } from "./WorkbenchBrand";

interface ThreePreviewSidebarProps {
  isReady: boolean;
  onReload: () => void;
}

export function ThreePreviewSidebar({ isReady, onReload }: ThreePreviewSidebarProps) {
  return (
    <ReactShellSidebar>
      <WorkbenchBrand
        eyebrow="系统诊断"
        title="标准三维面部模型预览"
        action={<RouteStatus>{isReady ? "ready" : "loading"}</RouteStatus>}
      />

      <Card>
        <Hint>
          这里用于验证三维模型资产、相机控制和基础渲染是否可用。医生病例主流程不需要进入本页。
        </Hint>
        <CardContent>
          <Button asChild>
            <Link to="/"><ArrowLeft size={16} /> 返回 React 入口</Link>
          </Button>
          <Button type="button" onClick={onReload}>
            <RotateCcw size={16} /> 重新加载资产
          </Button>
        </CardContent>
      </Card>
    </ReactShellSidebar>
  );
}
