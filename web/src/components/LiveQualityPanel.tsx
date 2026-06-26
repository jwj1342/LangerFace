import { Activity } from "lucide-react";

import { Card, CardHeader } from "./ui/card";
import { Hint } from "./ui/hint";
import { StatGrid, StatItem } from "./ui/key-value";

export function LiveQualityPanel() {
  return (
    <Card className="live-quality-panel" data-frame-owned="true">
      <div>
        <CardHeader>
          <span className="inline-flex items-center gap-2"><Activity size={14} /> 追踪质量</span>
          <span id="qualityVal">未开始 0%</span>
        </CardHeader>
        <div className="bar"><div className="bar-fill" id="qualityBar" /></div>
      </div>
      <StatGrid className="hidden">
        <StatItem label="状态" value="未开始" valueProps={{ id: "statState" }} />
        <StatItem label="脸部占比" value="—" valueProps={{ id: "statFace" }} />
        <StatItem label="偏航估计" value="—" valueProps={{ id: "statYaw" }} />
        <StatItem label="线束数量" value="—" valueProps={{ id: "statLines" }} />
      </StatGrid>
      <div className="overlay-qa hidden" id="incisionOverlayQa">
        <div className="overlay-qa-top">
          <span>切口叠加 QA</span>
          <span id="incisionOverlayQaState">等待画面</span>
        </div>
        <p id="incisionOverlayQaDetail">上传照片、视频或开启摄像头后开始检查。</p>
      </div>
      <Hint>姿态与光照自适应 · 全程本地运行，不上传任何画面</Hint>
    </Card>
  );
}
