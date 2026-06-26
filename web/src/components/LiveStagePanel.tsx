export function LiveStagePanel() {
  return (
    <main className="stage">
      <div className="stage-top">
        <span className="live" id="livePill"><span className="dot" />待机</span>
        <span className="fps" id="fps">— fps</span>
      </div>
      <div className="stage-body">
        <div className="main-wrap">
          <video id="video" playsInline autoPlay muted />
          <canvas id="canvas" className="mirror" width="1280" height="720" />
          <canvas id="three" className="hidden" />
          <div className="scan-toast hidden" id="scanToast">扫描中：请缓慢左右转头</div>
          <div className="overlay-msg" id="overlayMsg">点击「摄像头」或「上传照片 / 视频」开始</div>
        </div>
        <div className="zoom-strip" id="zoomStrip" />
      </div>
    </main>
  );
}
