import { Link } from "react-router-dom";

import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { Card } from "./ui/card";
import { Hint } from "./ui/hint";
import { Label } from "./ui/label";
import { Select } from "./ui/select";
import { WRINKLE_PIPELINE_DISPLAY } from "../services/wrinklePipelineVersion.ts";

export function LiveWrinklePanel() {
  return (
    <Card id="liveWrinkleCard">
      <div>
        <Label htmlFor="wrinkleDisplayMode">皱纹检测与自动微调</Label>
        <Hint className="live-inline-top">
          上传照片或定格摄像头后，YOLO 会在本机自动检测皱纹。检测结果仅作研究辅助，不替代医生判断。
        </Hint>
        <Hint className="live-inline-top">
          当前部署：{WRINKLE_PIPELINE_DISPLAY}（每张输入均重新检测与微调，后台 Worker 执行）
        </Hint>
      </div>
      <Select id="wrinkleDisplayMode" defaultValue="both" disabled aria-label="画面叠加内容">
        <option value="rstl">只显示 RSTL</option>
        <option value="wrinkles">只显示皱纹</option>
        <option value="both">RSTL 与皱纹同时显示</option>
      </Select>
      <div className="live-refine-status">
        <span>检测状态</span>
        <span id="wrinkleStatus">等待照片或定格帧</span>
      </div>
      <Hint id="wrinkleSummary">标准 RSTL 会先显示，皱纹检测在后台完成。</Hint>
      <ButtonRow>
        <Button variant="workbench" id="wrinkleDetectBtn" type="button" disabled>重新检测皱纹</Button>
        <Button variant="workbenchPrimary" id="wrinkleAutoRefineBtn" type="button" disabled>
          皱纹引导自动微调
        </Button>
      </ButtonRow>
      <Button variant="workbench" id="wrinkleRestoreBtn" type="button" disabled>
        恢复标准 RSTL
      </Button>
      <Hint>
        自动微调不会打开医生手动编辑器；应用后仍可使用下方“医生手动微调（2D）”继续调整。
        如需复现受控单图的完整审计图，可打开 <a href="/compat/personalized/wrinkle_rstl_experiment.html">
          v8.1.96 / v10 受控证据 / V9 单图实验
        </a>；多表情严格并集流程请进入 <Link to="/personalized">高级多表情采集</Link>。
      </Hint>
    </Card>
  );
}
