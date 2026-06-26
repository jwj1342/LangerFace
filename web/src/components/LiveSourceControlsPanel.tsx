import { useLiveStore } from "../stores/liveStore";

const LIVE_SOURCE_REACT_COMMAND_EVENT = "langerface:live-source-react-command";

function dispatchSourceCommand(command: string) {
  window.dispatchEvent(new CustomEvent(LIVE_SOURCE_REACT_COMMAND_EVENT, { detail: { command } }));
}

export function LiveSourceControlsPanel() {
  const snapshot = useLiveStore((state) => state.snapshot);
  const running = Boolean(snapshot?.source.running);
  const paused = Boolean(snapshot?.source.paused);
  const recording = Boolean(snapshot?.recording);
  const hasSource = running || Boolean(snapshot?.source.kind);

  return (
    <div className="card">
      <button className="btn btn-primary" id="uploadBtn" type="button" onClick={() => dispatchSourceCommand("upload_source")}>⬆&nbsp; 上传照片 / 视频</button>
      <input type="file" id="fileInput" accept="image/*,video/*" hidden />
      <div className="btn-row">
        <button className="btn" id="camBtn" type="button" aria-pressed={running && snapshot?.source.kind === "camera"} onClick={() => dispatchSourceCommand("camera_toggle")}>◉ 摄像头</button>
        <button className="btn" id="pauseBtn" type="button" disabled={!running} onClick={() => dispatchSourceCommand("pause_toggle")}>{paused ? "▶ 继续" : "⏸ 暂停"}</button>
        <button className="btn" id="exportBtn" type="button" disabled={!hasSource} aria-pressed={recording || undefined} onClick={() => dispatchSourceCommand("recording_toggle")}>{recording ? "■ 停止" : "⬇ 导出"}</button>
      </div>
    </div>
  );
}
