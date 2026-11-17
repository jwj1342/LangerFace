export function LiveQualityPanel() {
  return (
    <div
      className="hidden"
      data-quality-runtime="true"
      aria-hidden="true"
    >
      <span id="qualityVal">未开始 0%</span>
      <span id="qualityBar" />
      <span id="statState">未开始</span>
      <span id="statFace">—</span>
      <span id="statYaw">—</span>
      <span id="statLines">—</span>
      <div id="incisionOverlayQa" className="hidden">
        <span id="incisionOverlayQaState">等待画面</span>
        <p id="incisionOverlayQaDetail">上传照片或开启摄像头后开始检查。</p>
      </div>
    </div>
  );
}
