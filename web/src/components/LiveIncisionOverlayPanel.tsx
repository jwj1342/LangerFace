import { Scissors } from "lucide-react";

import { useLiveControllerCommands } from "../hooks/useControllerCommands";
import { useLiveStore } from "../stores/liveStore";
import { Button } from "./ui/button";
import { Card, CardHeader } from "./ui/card";
import { Hint } from "./ui/hint";
import { StatusBadge } from "./ui/status-badge";

export function LiveIncisionOverlayPanel() {
  const commands = useLiveControllerCommands();
  const overlay = useLiveStore((state) => state.snapshot?.incisionOverlay);

  if (!overlay?.loaded) return null;

  return (
    <Card id="liveIncisionOverlayCard" aria-live="polite">
      <CardHeader>
        <span><Scissors size={14} /> 切口候选叠加</span>
        <StatusBadge id="liveIncisionOverlayState">{overlay.qaLabel || "已载入"}</StatusBadge>
      </CardHeader>
      <Hint>候选切口将以青绿色高亮显示。上传照片或开启摄像头即可查看；姿态不合格时会显示复核原因。</Hint>
      <Button variant="workbench" id="clearIncisionOverlayBtn" type="button" onClick={() => commands.render("clear_incision_overlay")}>清除切口候选叠加</Button>
    </Card>
  );
}
