import { Link } from "react-router-dom";

import { LiveRenderControlsPanel } from "../components/LiveRenderControlsPanel";
import { LiveRouteControlsPanel } from "../components/LiveRouteControlsPanel";
import { LiveSourceControlsPanel } from "../components/LiveSourceControlsPanel";
import { LiveQualityPanel } from "../components/LiveQualityPanel";
import { LiveStagePanel } from "../components/LiveStagePanel";
import { LiveStatePanel } from "../components/LiveStatePanel";
import { Disclaimer, WorkbenchLayout } from "../components/WorkbenchLayout";
import { WorkbenchBrand } from "../components/WorkbenchBrand";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Hint } from "../components/ui/hint";
import { Label } from "../components/ui/label";
import { StatusBadge } from "../components/ui/status-badge";

export function LiveWorkbench() {
  return (
    <WorkbenchLayout
      stage={<LiveStagePanel />}
      workspace="live"
    >
      <WorkbenchBrand
        eyebrow="病例步骤一 · 面部评估"
        title="面部评估与张力线映射"
        action={<StatusBadge className="loading" id="modelBadge">模型加载中...</StatusBadge>}
      />

      <LiveRouteControlsPanel />

      <Card id="incisionWorkflowCard">
        <div>
          <Label>病灶与切口规划</Label>
          <Hint className="live-inline-top">记录皮下 / 皮表病灶，生成线性或梭形候选切口，并查看规划依据、审阅记录和导出状态。</Hint>
        </div>
        <Button asChild variant="workbenchPrimary">
          <Link to="/incision">进入切口规划</Link>
        </Button>
      </Card>

      <LiveStatePanel />

      <LiveSourceControlsPanel />

      <LiveRenderControlsPanel />

      <LiveQualityPanel />

      <Disclaimer>
        内置图谱为示意性首版（未经临床验证），方向参考 Borges RSTL。
        决策辅助可视化，非手术指令、非医疗器械；最终切口由主刀医生负责。
      </Disclaimer>
    </WorkbenchLayout>
  );
}
