import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { Card } from "./ui/card";
import { Select } from "./ui/select";
import { WorkflowLayerVisibilityButtons } from "./MobileWorkflowControls";

export function LiveWrinklePanel() {
  return (
    <Card id="liveWrinkleCard">
      <Select id="wrinkleDisplayMode" defaultValue="both" disabled aria-label="画面叠加内容">
        <option value="rstl">只显示 RSTL</option>
        <option value="wrinkles">只显示皱纹</option>
        <option value="both">RSTL 与皱纹同时显示</option>
      </Select>
      {/* 仅切换已有结果的可见性；不触碰 RSTL/皱纹生成、检测或参数。 */}
      <div className="desktop-layer-controls">
        <div className="desktop-layer-controls-heading">
          <span>叠加图层</span>
          <small>可分别显示或隐藏，结果仍会保留</small>
        </div>
        <WorkflowLayerVisibilityButtons />
      </div>
      <div className="live-refine-status">
        <span>检测状态</span>
        <span id="wrinkleStatus">等待照片、视频或摄像头</span>
      </div>
      <div className="hidden" id="wrinkleSummary" aria-hidden="true" />
      <ButtonRow className="live-wrinkle-actions">
        <Button variant="workbench" id="wrinkleDetectBtn" type="button" disabled>检测皱纹</Button>
        <Button variant="workbenchPrimary" id="wrinkleAutoRefineBtn" type="button" disabled>
          皱纹引导自动微调
        </Button>
      </ButtonRow>
      <Button variant="workbench" id="wrinkleRestoreBtn" type="button" disabled>
        恢复标准 RSTL
      </Button>
    </Card>
  );
}
