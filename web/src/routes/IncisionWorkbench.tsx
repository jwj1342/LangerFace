import { Link } from "react-router-dom";

import { CandidateResultPanel } from "../components/CandidateResultPanel";
import { EditControlsPanel } from "../components/EditControlsPanel";
import { IncisionStatePanel } from "../components/IncisionStatePanel";
import { ProviderConfigPanel } from "../components/ProviderConfigPanel";
import { ReviewControlsPanel } from "../components/ReviewControlsPanel";
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

        <div className="card agent-grid">
          <div className="quality-top"><span>辅助线索</span><span id="secondaryCueState">未导入</span></div>
          <p className="agent-note" id="secondaryCueSummary">仅展示自然皱襞、皱纹和皮表肿物边界的低置信度线索；不会自动改变肿物边界或候选切口。</p>
          <div className="btn-row two-cols">
            <button className="btn" id="importSecondaryCueBtn" type="button">导入线索</button>
            <button className="btn" id="clearSecondaryCueBtn" type="button">清空线索</button>
          </div>
          <input id="secondaryCueImportFile" className="hidden" type="file" accept="application/json,.json" />
          <label className="check"><input type="checkbox" id="secondaryCueConfirmed" /> 已人工确认辅助线索</label>
        </div>

        <ProviderConfigPanel />

        <CandidateResultPanel />

        <EditControlsPanel />

        <ReviewControlsPanel />

        <div className="card agent-grid">
          <div className="quality-top"><span>候选库</span><span id="savedCount">0</span></div>
          <button className="btn btn-primary" id="saveCandidateBtn" type="button">保存当前候选</button>
          <div className="btn-row two-cols">
            <button className="btn" id="makeVariantsBtn" type="button">生成备选</button>
            <button className="btn" id="clearSavedBtn" type="button">清空候选库</button>
          </div>
          <div className="btn-row three-cols">
            <button className="btn" id="exportJsonBtn" type="button">导出 JSON</button>
            <button className="btn" id="exportReportBtn" type="button">导出报告</button>
            <button className="btn" id="exportPngBtn" type="button">导出截图</button>
          </div>
          <button className="btn" id="stageLiveOverlayBtn" type="button">发送到实时叠加</button>
          <div className="candidate-list" id="candidateList"></div>
        </div>

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
