import { dispatchLiveSourceCommand } from "../lib/controllerCommand";
import { useLiveStore } from "../stores/liveStore";
import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { Card } from "./ui/card";
import { Input } from "./ui/input";

export function LiveSourceControlsPanel() {
  const snapshot = useLiveStore((state) => state.snapshot);
  const running = Boolean(snapshot?.source.running);
  const paused = Boolean(snapshot?.source.paused);
  const recording = Boolean(snapshot?.recording);
  const hasSource = running || Boolean(snapshot?.source.kind);

  return (
    <Card>
      <Button variant="workbenchPrimary" id="uploadBtn" type="button" onClick={() => dispatchLiveSourceCommand("upload_source")}>⬆&nbsp; 上传照片 / 视频</Button>
      <Input type="file" id="fileInput" accept="image/*,video/*" hidden />
      <ButtonRow>
        <Button variant="workbench" id="camBtn" type="button" aria-pressed={running && snapshot?.source.kind === "camera"} onClick={() => dispatchLiveSourceCommand("camera_toggle")}>◉ 摄像头</Button>
        <Button variant="workbench" id="pauseBtn" type="button" disabled={!running} onClick={() => dispatchLiveSourceCommand("pause_toggle")}>{paused ? "▶ 继续" : "⏸ 暂停"}</Button>
        <Button variant="workbench" id="exportBtn" type="button" disabled={!hasSource} aria-pressed={recording || undefined} onClick={() => dispatchLiveSourceCommand("recording_toggle")}>{recording ? "■ 停止" : "⬇ 导出"}</Button>
      </ButtonRow>
    </Card>
  );
}
