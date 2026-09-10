import { Link } from "react-router-dom";

import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { Card } from "./ui/card";
import { Hint } from "./ui/hint";
import { Label } from "./ui/label";
import { Select } from "./ui/select";

export function LiveWrinklePanel() {
  return (
    <Card id="liveWrinkleCard">
      <div>
        <Label htmlFor="wrinkleDisplayMode">皱纹检测与可选微调</Label>
        <Hint className="live-inline-top">
          照片、视频和摄像头均使用 YOLO 皱纹检测。
        </Hint>
        <Hint className="live-inline-top">
          当前检测：YOLO。
        </Hint>
        <Hint className="live-inline-top">
          {import.meta.env?.VITE_SERVER_COMPUTE === 'true'
            ? 'YOLO 皱纹检测在服务器 GPU 执行；实时跟踪和绘制在当前浏览器执行。'
            : '当前皱纹检测在浏览器内完成，不向 V10 服务发送图像。'}
        </Hint>
      </div>
      <Select id="wrinkleDisplayMode" defaultValue="both" disabled aria-label="画面叠加内容">
        <option value="rstl">只显示 RSTL</option>
        <option value="wrinkles">只显示皱纹</option>
        <option value="both">RSTL 与皱纹同时显示</option>
      </Select>
      <div className="live-refine-status">
        <span>检测状态</span>
        <span id="wrinkleStatus">等待照片、视频或摄像头</span>
      </div>
      <Hint id="wrinkleSummary">等待图像。</Hint>
      <ButtonRow>
        <Button variant="workbench" id="wrinkleDetectBtn" type="button" disabled>检测皱纹</Button>
        <Button variant="workbenchPrimary" id="wrinkleAutoRefineBtn" type="button" disabled title="仅 YOLO 模式不提供旧版自动微调">
          皱纹引导自动微调
        </Button>
      </ButtonRow>
      <Button variant="workbench" id="wrinkleRestoreBtn" type="button" disabled>
        恢复标准 RSTL
      </Button>
      <Hint>
        可使用“医生手动微调（2D）”调整 RSTL。旧版自动微调未启用。
        如需复现受控单图的完整审计图，可打开 <a href="/compat/personalized/wrinkle_rstl_experiment.html">
          v8.1.96 / v10 受控证据 / V9 单图实验
        </a>；多表情严格并集流程请进入 <Link to="/personalized">高级多表情采集</Link>。
      </Hint>
    </Card>
  );
}
