import { Activity } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Card, CardHeader, CardHeaderTitle } from "./ui/card";
import { Hint } from "./ui/hint";
import { StatGrid, StatItem } from "./ui/key-value";
import { LiveOverlayQa, LiveOverlayQaHeader } from "./ui/live-feedback";
import { ProgressBar } from "./ui/progress";

interface LiveQualityPanelProps {
  mobilePortalSelector?: string;
}

const MOBILE_WORKFLOW_MEDIA_QUERY = "(max-width: 560px) and (pointer: coarse) and (hover: none)";

export function LiveQualityPanel({ mobilePortalSelector }: LiveQualityPanelProps = {}) {
  const [mobileTarget, setMobileTarget] = useState<Element | null>(null);

  useEffect(() => {
    if (!mobilePortalSelector || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(MOBILE_WORKFLOW_MEDIA_QUERY);
    const sync = () => setMobileTarget(media.matches ? document.querySelector(mobilePortalSelector) : null);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [mobilePortalSelector]);

  useEffect(() => {
    if (!mobilePortalSelector) return;
    window.dispatchEvent(new Event("langerface:live-quality-relocated"));
  }, [mobilePortalSelector, mobileTarget]);

  const panel = (
    <Card
      className={mobileTarget ? "live-quality-panel mobile-canvas-quality" : "live-quality-panel"}
      data-frame-owned="true"
      aria-live="polite"
    >
      <div>
        <CardHeader>
          <CardHeaderTitle><Activity size={14} /> {mobileTarget ? "跟踪质量参考" : "追踪质量"}</CardHeaderTitle>
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
        <p id="incisionOverlayQaDetail">上传照片或开启摄像头后开始检查。</p>
      </LiveOverlayQa>
      <Hint>{mobileTarget ? "受分辨率与光线影响" : "姿态与光照自适应 · 全程本地运行，不上传任何画面"}</Hint>
    </Card>
  );

  return mobileTarget ? createPortal(panel, mobileTarget) : panel;
}
