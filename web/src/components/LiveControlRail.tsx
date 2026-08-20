import { Link } from "react-router-dom";

import { LiveIncisionOverlayPanel } from "./LiveIncisionOverlayPanel";
import { LiveQualityPanel } from "./LiveQualityPanel";
import { LiveRefinePanel } from "./LiveRefinePanel";
import { LiveRenderControlsPanel } from "./LiveRenderControlsPanel";
import { LiveRouteControlsPanel } from "./LiveRouteControlsPanel";
import { LiveSourceControlsPanel } from "./LiveSourceControlsPanel";
import { LiveStagePanel } from "./LiveStagePanel";
import { LiveStatePanel } from "./LiveStatePanel";
import { LiveWrinklePanel } from "./LiveWrinklePanel";
import { Disclaimer } from "./WorkbenchLayout";
import { WorkbenchBrand } from "./WorkbenchBrand";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Hint } from "./ui/hint";
import { Label } from "./ui/label";
import { StatusBadge } from "./ui/status-badge";

interface LiveControlRailProps {
  showIncisionEntry?: boolean;
  showStatusOverview?: boolean;
  showPersonalizedHint?: boolean;
}

export function LiveControlRail({
  showIncisionEntry = true,
  showStatusOverview = true,
  showPersonalizedHint = true,
}: LiveControlRailProps) {
  return (
    <>
      <WorkbenchBrand
        eyebrow="实时 2D 研究工具"
        title="面部评估与张力线映射"
        action={<StatusBadge className="loading" id="modelBadge">模型加载中...</StatusBadge>}
      />

      {showStatusOverview ? <LiveRouteControlsPanel /> : null}

      <Card id="incisionWorkflowCard" visible={showIncisionEntry}>
        <div>
          <Label>病灶与切口规划</Label>
          <Hint className="live-inline-top">记录皮下 / 皮表病灶，生成线性或梭形候选切口，并查看规划依据、审阅记录和导出状态。</Hint>
        </div>
        <Button asChild variant="workbenchPrimary">
          <Link to="/incision">进入切口规划</Link>
        </Button>
      </Card>

      {showStatusOverview ? <LiveStatePanel /> : null}
      <LiveIncisionOverlayPanel />
      <LiveSourceControlsPanel />
      <LiveWrinklePanel showAdvancedCaptureHint={showPersonalizedHint} />
      <LiveRefinePanel />
      <LiveRenderControlsPanel />
      <LiveQualityPanel />

      <Disclaimer>
        内置图谱为示意性首版（未经临床验证），方向参考 Borges RSTL。
        决策辅助可视化，非手术指令、非医疗器械；最终切口由主刀医生负责。
      </Disclaimer>
    </>
  );
}

export { LiveStagePanel };
