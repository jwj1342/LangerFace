import { Link } from "react-router-dom";

import { LiveRenderControlsPanel } from "../components/LiveRenderControlsPanel";
import { LiveRouteControlsPanel } from "../components/LiveRouteControlsPanel";
import { LiveSourceControlsPanel } from "../components/LiveSourceControlsPanel";
import { LiveStatePanel } from "../components/LiveStatePanel";

export function LiveWorkbench() {
  return (
    <div className="app live-workbench">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-top">
            <span className="eyebrow">COMPUTER VISION PROTOTYPE</span>
            <span className="badge loading" id="modelBadge">模型加载中...</span>
          </div>
          <h1>面部朗格线迁移</h1>
        </div>

        <LiveRouteControlsPanel />

        <div className="card" id="incisionWorkflowCard">
          <div>
            <label className="field-label">肿物切口候选设计</label>
            <p className="hint live-inline-top">手动放置皮下 / 皮表肿物，生成线性或梭形候选切口，并查看规则、trace、隐私审计和医生调整记录。</p>
          </div>
          <Link className="btn btn-primary" to="/incision">打开切口 Agent 工作台</Link>
        </div>

        <LiveStatePanel />

        <LiveSourceControlsPanel />

        <LiveRenderControlsPanel />

        <div className="card">
          <div>
            <div className="quality-top"><span>追踪质量</span><span id="qualityVal">未开始 0%</span></div>
            <div className="bar"><div className="bar-fill" id="qualityBar" /></div>
          </div>
          <div className="stat-grid hidden">
            <div className="stat"><span className="k">状态</span><span className="v" id="statState">未开始</span></div>
            <div className="stat"><span className="k">脸部占比</span><span className="v" id="statFace">—</span></div>
            <div className="stat"><span className="k">偏航估计</span><span className="v" id="statYaw">—</span></div>
            <div className="stat"><span className="k">线束数量</span><span className="v" id="statLines">—</span></div>
          </div>
          <div className="overlay-qa hidden" id="incisionOverlayQa">
            <div className="overlay-qa-top">
              <span>切口叠加 QA</span>
              <span id="incisionOverlayQaState">等待画面</span>
            </div>
            <p id="incisionOverlayQaDetail">上传照片、视频或开启摄像头后开始检查。</p>
          </div>
          <p className="hint">姿态与光照自适应 · 全程本地运行，不上传任何画面</p>
        </div>

        <p className="disclaimer">
          ⚠️ 内置图谱为示意性首版（未经临床验证），方向参考 Borges RSTL。
          决策辅助可视化，非手术指令、非医疗器械；最终切口由主刀医生负责。
        </p>
      </aside>

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
    </div>
  );
}
