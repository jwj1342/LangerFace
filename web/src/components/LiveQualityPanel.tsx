import { Activity } from "lucide-react";

import { Card, CardHeader, CardHeaderTitle } from "./ui/card";
import { Hint } from "./ui/hint";
import { StatGrid, StatItem } from "./ui/key-value";
import { LiveOverlayQa, LiveOverlayQaHeader } from "./ui/live-feedback";
import { ProgressBar } from "./ui/progress";

export function LiveQualityPanel() {
  return (
    <Card className="live-quality-panel" data-frame-owned="true">
      <div>
        <CardHeader>
          <CardHeaderTitle><Activity size={14} /> 追踪质量</CardHeaderTitle>
          <span id="qualityVal">未开始 0%</span>
        </CardHeader>
        <ProgressBar fillProps={{ id: "qualityBar" }} />
      </div>
      <StatGrid visible={false}>
        <StatItem label="状态" value="未开始" valueProps={{ id: "statState" }} />
        <StatItem label="脸部占比" value="—" valueProps={{ id: "statFace" }} />
        <StatItem label="偏航估计" value="—" valueProps={{ id: "statYaw" }} />
        <StatItem label="线束数量" value="—" valueProps={{ id: "statLines" }} />
      </StatGrid>
      <LiveOverlayQa id="incisionOverlayQa" visible={false}>
        <LiveOverlayQaHeader>
          <span>切口叠加 QA</span>
          <span id="incisionOverlayQaState">等待画面</span>
        </LiveOverlayQaHeader>
        <p id="incisionOverlayQaDetail">上传照片、视频或开启摄像头后开始检查。</p>
      </LiveOverlayQa>
      <Hint>姿态与光照自适应 · 全程本地运行，不上传任何画面</Hint>
    </Card>
  );
}
