import { Link } from "react-router-dom";

import { LiveRenderControlsPanel } from "../components/LiveRenderControlsPanel";
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

        <div className="card">
          <label className="field-label" htmlFor="routeSel">技术路线</label>
          <select id="routeSel" className="select live-inline-top" defaultValue="2d">
            <option value="2d">2D 贴合（默认，稳定）</option>
            <option value="3d">3D 重建（Beta）</option>
          </select>
          <p className="hint live-inline-top" id="routeModeHint">当前是 2D 实时贴合模式，只显示稳定主流程。</p>
          <div id="route3dPanel" className="hidden live-stack">
            <div className="btn-row live-two-col">
              <button className="btn" id="reconDemoBtn" type="button">用示例脸（无摄像头）</button>
              <button className="btn" id="reconScanBtn" type="button">转头扫描</button>
            </div>
            <p className="hint" id="reconStatus">先重建你的 3D 人头 → 可旋转查看 → 再投影到实时画面。</p>
            <div className="scan-panel hidden" id="scanPanel">
              <div className="scan-row"><span>扫描进度</span><span id="scanProgressVal">0%</span></div>
              <div className="bar"><div className="bar-fill" id="scanProgressBar" /></div>
              <div className="scan-row"><span>角度覆盖</span><span id="scanYawVal">0.00</span></div>
              <div className="yaw-meter">
                <span id="scanYawLeft" />
                <span id="scanYawMid" />
                <span id="scanYawRight" />
              </div>
            </div>
            <div className="btn-row live-two-col">
              <button className="btn" id="view3dBtn" type="button" disabled aria-pressed="true">旋转查看</button>
              <button className="btn" id="project3dBtn" type="button" disabled>投影到画面</button>
            </div>
            <button className="btn" id="reset3dBtn" type="button" disabled>复位视角</button>
            <button className="btn btn-primary" id="cloudFitFlameBtn" type="button">▶ 实时孪生（左真脸 / 右 FLAME 随动）</button>
            <label className="check live-hidden-inline" id="flameHeadToggleWrap">
              <input type="checkbox" id="flameStdToggle" /> 显示标准头（取消勾选 = 个体）
            </label>
            <label className="check live-hidden-inline" id="twinTextureWrap">
              <input type="checkbox" id="twinTextureToggle" /> 贴真实人脸纹理
            </label>
          </div>
        </div>

        <div className="card hidden" id="threeDWorkflowCard">
          <div>
            <label className="field-label">3D 线标注与研究演示</label>
            <p className="hint live-inline-top">在 3D 标准脸上绘制 RSTL 候选线，并从标注页进入沿 RSTL 闭合力学演示。</p>
          </div>
          <Link className="btn btn-primary" to="/annotate">打开 3D 线标注</Link>
        </div>

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
