import { Link } from "react-router-dom";

import { CandidateLibraryPanel } from "../components/CandidateLibraryPanel";
import { CandidateResultPanel } from "../components/CandidateResultPanel";
import { EditControlsPanel } from "../components/EditControlsPanel";
import { IncisionStatePanel } from "../components/IncisionStatePanel";
import { ProviderConfigPanel } from "../components/ProviderConfigPanel";
import { ReviewControlsPanel } from "../components/ReviewControlsPanel";
import { SecondaryCuePanel } from "../components/SecondaryCuePanel";
import { TumorInputPanel } from "../components/TumorInputPanel";

export function IncisionWorkbench() {
  return (
    <div className="app incision-workbench">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-top">
            <span className="eyebrow">STAGE 2 · AGENTIC INCISION</span>
            <Link className="badge" to="/live">返回实时显示</Link>
          </div>
          <h1>切口 Agent 工作台</h1>
        </div>

        <IncisionStatePanel />

        <TumorInputPanel />

        <SecondaryCuePanel />

        <ProviderConfigPanel />

        <CandidateResultPanel />

        <EditControlsPanel />

        <ReviewControlsPanel />

        <CandidateLibraryPanel />

        <div className="card">
          <div className="quality-top"><span>隐私 / 审计</span><span id="privacyState">本地几何</span></div>
          <p className="hint" id="privacyAudit">不上传原始影像；Agent 只接收肿物参数、抽象坐标、规则和候选几何。</p>
        </div>

        <p className="disclaimer">⚠️ 研究原型：LLM 只做编排摘要，方向、几何和 guardrails 均由确定性工具输出。候选切口必须由医生审阅确认。</p>
      </aside>

      <main className="stage">
        <div className="stage-top">
          <span className="live on"><span className="dot"></span>标准脸规划</span>
          <div className="stage-actions">
            <span className="fps" id="stageStatus">拖拽旋转 · 滚轮缩放 · 点击定位</span>
            <Link className="stage-link fps" to="/annotate">3D 标注与演示</Link>
          </div>
        </div>
        <div className="stage-body">
          <div className="main-wrap">
            <canvas id="agentCanvas"></canvas>
            <div className="asset-loading" id="assetLoading" role="status" aria-live="polite">
              <div className="asset-spinner" aria-hidden="true"></div>
              <strong>正在加载切口规划资产</strong>
              <p id="assetLoadingText">准备下载标准脸、拓扑和 RSTL 图谱。</p>
            </div>
            <div className="canvas-legend" aria-label="3D 标注图例">
              <span className="legend-item"><span className="legend-swatch center"></span>病灶中心</span>
              <span className="legend-item"><span className="legend-swatch ring"></span>肿物范围</span>
              <span className="legend-item"><span className="legend-swatch line"></span>候选切口</span>
              <span className="legend-item"><span className="legend-swatch handle"></span>端点控制</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
