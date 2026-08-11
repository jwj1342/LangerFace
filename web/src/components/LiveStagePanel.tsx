import {
  StageCanvas,
  StageMeta,
  StageOverlayMessage,
  StageShell,
  StageStatus,
  StageViewport,
  StageZoomStrip,
} from "./StageShell";

export function LiveStagePanel() {
  return (
    <StageShell
      top={(
        <>
          <StageStatus id="livePill">待机</StageStatus>
          <StageMeta id="fps">— fps</StageMeta>
        </>
      )}
    >
      <StageViewport>
        <video id="video" playsInline autoPlay muted />
        <StageCanvas id="canvas" mirror width="1280" height="720" />
        <StageOverlayMessage id="overlayMsg">点击「摄像头」或「上传照片 / 视频」开始</StageOverlayMessage>
      </StageViewport>
      <StageZoomStrip id="zoomStrip" />
    </StageShell>
  );
}
