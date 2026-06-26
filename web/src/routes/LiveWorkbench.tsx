import { Link } from "react-router-dom";

import { LiveRenderControlsPanel } from "../components/LiveRenderControlsPanel";
import { LiveRouteControlsPanel } from "../components/LiveRouteControlsPanel";
import { LiveSourceControlsPanel } from "../components/LiveSourceControlsPanel";
import { LiveQualityPanel } from "../components/LiveQualityPanel";
import { LiveStagePanel } from "../components/LiveStagePanel";
import { LiveStatePanel } from "../components/LiveStatePanel";
import { WorkbenchBrand } from "../components/WorkbenchBrand";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Label } from "../components/ui/label";

export function LiveWorkbench() {
  return (
    <div className="app live-workbench">
      <aside className="sidebar">
        <WorkbenchBrand
          eyebrow="COMPUTER VISION PROTOTYPE"
          title="面部朗格线迁移"
          action={<span className="badge loading" id="modelBadge">模型加载中...</span>}
        />

        <LiveRouteControlsPanel />

        <Card id="incisionWorkflowCard">
          <div>
            <Label>肿物切口候选设计</Label>
            <p className="hint live-inline-top">手动放置皮下 / 皮表肿物，生成线性或梭形候选切口，并查看规则、trace、隐私审计和医生调整记录。</p>
          </div>
          <Button asChild variant="workbenchPrimary">
            <Link to="/incision">打开切口 Agent 工作台</Link>
          </Button>
        </Card>

        <LiveStatePanel />

        <LiveSourceControlsPanel />

        <LiveRenderControlsPanel />

        <LiveQualityPanel />

        <p className="disclaimer">
          ⚠️ 内置图谱为示意性首版（未经临床验证），方向参考 Borges RSTL。
          决策辅助可视化，非手术指令、非医疗器械；最终切口由主刀医生负责。
        </p>
      </aside>

      <LiveStagePanel />
    </div>
  );
}
