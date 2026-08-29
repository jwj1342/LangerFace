import { useLiveControllerCommands } from "../hooks/useControllerCommands";
import { useLiveStore } from "../stores/liveStore";
import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { Card } from "./ui/card";
import { Input } from "./ui/input";

export function LiveSourceControlsPanel() {
  const commands = useLiveControllerCommands();
  const snapshot = useLiveStore((state) => state.snapshot);
  const running = Boolean(snapshot?.source.running);
  const paused = Boolean(snapshot?.source.paused);
  const recording = Boolean(snapshot?.recording);
  const cameraActive = running && snapshot?.source.kind === "camera";
  const hasSource = running || Boolean(snapshot?.source.kind);

  return (
    <Card id="liveInputCard">
      <Button variant="workbenchPrimary" id="uploadBtn" type="button" onClick={() => commands.source("upload_source")}>⬆&nbsp; 上传照片</Button>
      <Input type="file" id="fileInput" accept="image/*" hidden />
      <ButtonRow>
        <Button variant="workbench" id="camBtn" type="button" aria-pressed={cameraActive} onClick={() => commands.source("camera_toggle")}>{cameraActive ? "■ 关闭摄像头" : "◉ 开启摄像头"}</Button>
        <Button variant="workbench" id="pauseBtn" type="button" disabled={!running} onClick={() => commands.source("pause_toggle")}>{paused ? "▶ 继续" : "⏸ 暂停"}</Button>
        <Button variant="workbench" id="exportBtn" type="button" disabled={!hasSource} aria-pressed={recording || undefined} onClick={() => commands.source("recording_toggle")}>{recording ? "■ 停止" : "⬇ 导出"}</Button>
      </ButtonRow>
    </Card>
  );
}
