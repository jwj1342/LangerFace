import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { Card } from "./ui/card";
import { Select } from "./ui/select";

export function LiveWrinklePanel() {
  return (
    <Card id="liveWrinkleCard">
      <Select id="wrinkleDisplayMode" defaultValue="both" disabled aria-label="画面叠加内容">
        <option value="rstl">只显示 RSTL</option>
        <option value="wrinkles">只显示皱纹</option>
        <option value="both">RSTL 与皱纹同时显示</option>
      </Select>
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
