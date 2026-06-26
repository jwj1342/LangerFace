import { Activity } from "lucide-react";

import { Card, CardHeader } from "./ui/card";

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
      <div className="stat-grid hidden">
        <div className="stat"><span className="k">状态</span><span className="v" id="statState">未开始</span></div>
        <div className="stat"><span className="k">脸部占比</span><span className="v" id="statFace">—</span></div>
        <div className="stat"><span className="k">偏航估计</span><span className="v" id="statYaw">—</span></div>
        <div className="stat"><span className="k">线束数量</span><span className="v" id="statLines">—</span></div>
      </div>
      <div className="overlay-qa hidden" id="incisionOverlayQa">
        <div className="overlay-qa-top">
          <span>切口叠加 QA</span>
          <span id="incisionOverlayQaState">等待画面</span>
        </div>
        <p id="incisionOverlayQaDetail">上传照片、视频或开启摄像头后开始检查。</p>
      </div>
      <p className="hint">姿态与光照自适应 · 全程本地运行，不上传任何画面</p>
    </Card>
  );
}
