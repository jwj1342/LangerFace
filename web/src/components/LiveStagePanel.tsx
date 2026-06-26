import { StageShell, StageViewport } from "./StageShell";

export function LiveStagePanel() {
  return (
    <StageShell
      top={(
        <>
          <span className="live" id="livePill"><span className="dot" />待机</span>
          <span className="fps" id="fps">— fps</span>
        </>
      )}
    >
      <StageViewport>
        <video id="video" playsInline autoPlay muted />
        <canvas id="canvas" className="mirror" width="1280" height="720" />
        <canvas id="three" className="hidden" />
        <div className="scan-toast hidden" id="scanToast">扫描中：请缓慢左右转头</div>
        <div className="overlay-msg" id="overlayMsg">点击「摄像头」或「上传照片 / 视频」开始</div>
      </StageViewport>
      <div className="zoom-strip" id="zoomStrip" />
    </StageShell>
  );
}
