import { Scissors } from "lucide-react";
import { Link } from "react-router-dom";

import { WorkbenchBrand } from "./WorkbenchBrand";
import { Button } from "./ui/button";
import { Card, CardHeader, CardHeaderTitle } from "./ui/card";
import { StatusBadge } from "./ui/status-badge";

export function WorkflowIncisionRail() {
  return (
    <>
      <WorkbenchBrand
        eyebrow="切口研究工具"
        title="切口规划与候选审阅"
        action={<StatusBadge>接线阶段</StatusBadge>}
      />
      <Card>
        <CardHeader>
          <CardHeaderTitle><Scissors size={14} /> 切口操作台</CardHeaderTitle>
          <span>兼容入口</span>
        </CardHeader>
        <Button asChild variant="workbenchPrimary">
          <Link to="/app/incision">打开独立切口工作台</Link>
        </Button>
      </Card>
    </>
  );
}
