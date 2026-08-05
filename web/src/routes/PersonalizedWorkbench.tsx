export function PersonalizedWorkbench() {
  return (
    <div className="personalized-page">
      <div className="personalized-app">
        <aside className="personalized-sidebar">
          <div>
            <div className="personalized-heading-row">
              <span className="personalized-eyebrow">GUIDED CAPTURE</span>
              <span className="personalized-badge warn" id="badge">准备中</span>
            </div>
            <h1>中性脸 RSTL 个性化</h1>
            <p className="personalized-hint personalized-heading-hint">最新 v8.1.67 · 133 条 RSTL · 每个表情采集一次 · 采集中质量检查 · 采集后在线 YOLO 0.07 严格并集 + V6</p>
            <a className="personalized-nav" href="/">← 返回研究工具入口</a>
          </div>

          <div className="personalized-card" id="guideCard">
            <p className="personalized-guide-title" id="guideTitle">准备开始</p>
            <p className="personalized-guide-sub" id="guideSub">请正对镜头并保持光线均匀；不同摄像头会自动调整证据置信度</p>
            <div className="personalized-meter-label"><span>表情强度</span><span id="scoreVal">0%</span></div>
            <div className="personalized-meter" id="scoreMeter"><i id="scoreFill" /></div>
            <div className="personalized-meter-label"><span>保持进度</span><span id="holdVal">0%</span></div>
            <div className="personalized-meter hold" id="holdMeter"><i id="holdFill" /></div>
            <p className="personalized-message" id="msg">点击「开始采集」</p>
            <button className="personalized-button primary" id="startBtn" type="button">开始采集</button>
            <button className="personalized-button" id="confirmBtn" type="button" disabled>确认完成本步</button>
            <div className="personalized-button-row">
              <button className="personalized-button" id="skipBtn" type="button" disabled>跳过本步</button>
              <button className="personalized-button" id="stopBtn" type="button" disabled>结束导出</button>
            </div>
            <label className="personalized-debug-option">
              <input id="recordDebugMedia" type="checkbox" />
              <span>记录静息及每个表情每轮的视频与同步关键点数据（默认关闭）</span>
            </label>
            <div className="personalized-privacy-note">默认只保留聚合诊断，不录制人脸视频。勾选后需再次确认：录制只用于算法调试，视频与关键点仅留在当前标签页内存中。</div>
            <div className="personalized-privacy-note">人脸图像、YOLO 推理和 V6 微调全部在当前浏览器本地完成，不上传服务器。</div>
            <button className="personalized-button" id="debugBtn" type="button" disabled>导出采集数据 JSON（含关键点）</button>
            <div id="debugMediaStatus" className="personalized-hint">尚未开始调试录制</div>
            <div id="debugMediaExports" className="personalized-exports" />
            <button className="personalized-button" id="discardDebugMediaBtn" type="button" disabled>丢弃调试录制（清除内存中的视频）</button>
          </div>

          <div className="personalized-card">
            <div className="personalized-card-label">采集步骤</div>
            <div className="personalized-steps" id="steps" />
          </div>

          <div className="personalized-card">
            <div className="personalized-card-label">皱纹证据与 V6 微调前后</div>
            <div className="personalized-local-pipeline">
              <strong>本地个性化处理</strong>
              <progress id="localPipelineProgress" max="100" value="0" />
              <div id="localPipelineStatus">采集完成后将在本机运行 YOLO 0.07 与 V6。</div>
            </div>
            <div id="compareSummary" className="personalized-hint">完成后显示相对原始 atlas 的偏移</div>
            <canvas id="compareCanvas" width="320" height="320" className="personalized-evidence-canvas is-hidden" />
            <div id="wrinkleMaskPanel" className="personalized-mask-panel is-hidden">
              <EvidenceCanvas title="正脸语义分割皱纹 Mask" hint="橙色=额头，蓝色=眉间，红色=一般皱纹；已配准到中性正脸坐标" canvasId="wrinkleSemanticCanvas" buttonId="wrinkleSemanticDownloadBtn" buttonLabel="下载正脸语义分割 Mask PNG" />
              <EvidenceCanvas title="跨表情配准审核图" hint="不同颜色代表不同表情；颜色应落在同一张中性正脸上。" canvasId="wrinkleAlignmentCanvas" buttonId="wrinkleAlignmentDownloadBtn" buttonLabel="下载跨表情配准审核图 PNG" />
              <EvidenceCanvas title="严格并集二值 Mask" canvasId="wrinkleMaskCanvas" buttonId="wrinkleMaskDownloadBtn" buttonLabel="下载二值皱纹 Mask PNG" />
              <EvidenceCanvas title="V6 去重/骨架证据图" hint="V6 实际用于曲线匹配的单次骨架证据；原始严格并集仍单独保留。" canvasId="wrinkleEvidenceCanvas" buttonId="wrinkleEvidenceDownloadBtn" buttonLabel="下载 V6 证据图 PNG" />
            </div>
            <button className="personalized-button primary" id="usePersonalizedBtn" type="button" disabled>进入切口设计（应用个性化 RSTL）</button>
            <div className="personalized-exports" id="exports"><span className="personalized-hint">完成后可下载对比图</span></div>
          </div>
          <p className="personalized-disclaimer">local YOLO strict-union + RSTL V6 refinement — experimental, not a surgical instruction</p>
        </aside>

        <main className="personalized-stage">
          <div className="personalized-stage-top">
            <span className="personalized-live" id="live"><span className="dot" />待机</span>
            <span id="fps">— fps</span>
          </div>
          <div className="personalized-stage-body">
            <div className="personalized-main-wrap">
              <video id="video" playsInline autoPlay muted />
              <canvas id="view" width="960" height="720" />
              <div className="personalized-boot" id="boot">点击左侧「开始采集」</div>
              <div className="personalized-countdown hidden" id="countdown">
                <div className="num" id="countNum">3</div>
                <div className="tip" id="countTip">准备抬眉</div>
              </div>
              <div className="personalized-coach hidden" id="coach">
                <h2 id="coachTitle">抬眉</h2>
                <p id="coachSub">慢慢抬起眉毛，保持 1 秒</p>
                <div className="personalized-coach-bar"><i id="coachBar" /></div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

interface EvidenceCanvasProps {
  title: string;
  hint?: string;
  canvasId: string;
  buttonId: string;
  buttonLabel: string;
}

function EvidenceCanvas({ title, hint, canvasId, buttonId, buttonLabel }: EvidenceCanvasProps) {
  return (
    <div className="personalized-evidence-block">
      <div className="personalized-card-label">{title}</div>
      {hint ? <div className="personalized-hint">{hint}</div> : null}
      <canvas id={canvasId} width="320" height="320" className="personalized-evidence-canvas" />
      <button className="personalized-button" id={buttonId} type="button">{buttonLabel}</button>
    </div>
  );
}
