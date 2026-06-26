import { dispatchControllerCommand } from "../lib/controllerCommand";
import { useLiveStore } from "../stores/liveStore";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const LIVE_SOURCE_REACT_COMMAND_EVENT = "langerface:live-source-react-command";

function dispatchSourceCommand(command: string) {
  dispatchControllerCommand(LIVE_SOURCE_REACT_COMMAND_EVENT, { command });
}

export function LiveSourceControlsPanel() {
  const snapshot = useLiveStore((state) => state.snapshot);
  const running = Boolean(snapshot?.source.running);
  const paused = Boolean(snapshot?.source.paused);
  const recording = Boolean(snapshot?.recording);
  const hasSource = running || Boolean(snapshot?.source.kind);

  return (
    <div className="card">
      <Button variant="workbenchPrimary" id="uploadBtn" type="button" onClick={() => dispatchSourceCommand("upload_source")}>⬆&nbsp; 上传照片 / 视频</Button>
      <Input type="file" id="fileInput" accept="image/*,video/*" hidden />
      <div className="btn-row">
        <Button variant="workbench" id="camBtn" type="button" aria-pressed={running && snapshot?.source.kind === "camera"} onClick={() => dispatchSourceCommand("camera_toggle")}>◉ 摄像头</Button>
        <Button variant="workbench" id="pauseBtn" type="button" disabled={!running} onClick={() => dispatchSourceCommand("pause_toggle")}>{paused ? "▶ 继续" : "⏸ 暂停"}</Button>
        <Button variant="workbench" id="exportBtn" type="button" disabled={!hasSource} aria-pressed={recording || undefined} onClick={() => dispatchSourceCommand("recording_toggle")}>{recording ? "■ 停止" : "⬇ 导出"}</Button>
      </div>
    </div>
  );
}
