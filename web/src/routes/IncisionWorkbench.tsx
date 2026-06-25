import { Link } from "react-router-dom";

import { IncisionStatePanel } from "../components/IncisionStatePanel";
import { ProviderConfigPanel } from "../components/ProviderConfigPanel";
import { ReviewControlsPanel } from "../components/ReviewControlsPanel";

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

        <div className="card agent-grid">
          <label className="field-label" htmlFor="tumorKind">肿物类型</label>
          <select id="tumorKind" className="select" defaultValue="subcutaneous">
            <option value="subcutaneous">皮下肿物 · 线性切口</option>
            <option value="cutaneous">皮表肿物 · 梭形切口</option>
          </select>
          <div>
            <label className="field-label" htmlFor="diameterMm">直径 mm <span id="diameterVal" className="val">12</span></label>
            <input id="diameterMm" type="range" min="4" max="40" defaultValue="12" />
          </div>
          <div>
            <label className="field-label" htmlFor="tumorAuthor">记录者</label>
            <input id="tumorAuthor" className="text-input" defaultValue="clinician" />
          </div>
          <div id="depthWrap">
            <label className="field-label" htmlFor="depthMm">深度 mm <span id="depthVal" className="val">6</span></label>
            <input id="depthMm" type="range" min="0" max="35" defaultValue="6" />
          </div>
          <div id="marginWrap" className="hidden">
            <label className="field-label" htmlFor="marginMm">安全切缘 mm <span id="marginVal" className="val">2</span></label>
            <input id="marginMm" type="range" min="0" max="10" defaultValue="2" />
          </div>
          <div id="boundaryWrap" className="hidden">
            <label className="field-label" htmlFor="boundaryMode">皮表边界</label>
            <select id="boundaryMode" className="select" defaultValue="ellipse">
              <option value="ellipse">椭圆近似</option>
              <option value="freehand">自由轮廓点</option>
            </select>
          </div>
          <div id="ellipseWrap" className="hidden">
            <label className="field-label" htmlFor="ellipseRatio">椭圆短轴比例 <span id="ellipseRatioVal" className="val">70%</span></label>
            <input id="ellipseRatio" type="range" min="40" max="100" defaultValue="70" />
          </div>
          <div className="btn-row hidden two-cols" id="freehandControls">
            <button className="btn" id="startBoundaryBtn" type="button">开始轮廓</button>
            <button className="btn" id="clearBoundaryBtn" type="button">清空轮廓</button>
          </div>
          <p className="boundary-status" id="boundaryStatus">皮表边界：中心直径</p>
          <div className="btn-row two-cols">
            <button className="btn" id="exportTumorBtn" type="button">导出肿物</button>
            <button className="btn" id="importTumorBtn" type="button">导入肿物</button>
          </div>
          <input id="tumorImportFile" className="hidden" type="file" accept="application/json,.json" />
          <button className="btn btn-primary" id="runAgentBtn" type="button">生成候选切口</button>
          <p className="agent-note" id="pickState">当前点位：默认右颊。右侧标准脸可点击重选。</p>
          <p className="anatomy-preview" id="anatomyPreview">当前点位分区：待加载</p>
        </div>

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

        <div className="card">
          <div className="quality-top"><span>候选结果</span><span id="candidateType">—</span></div>
          <div className="metric-grid">
            <div className="metric"><span className="k">长度</span><span className="v" id="candidateLength">—</span></div>
            <div className="metric"><span className="k">宽度 / 比例</span><span className="v" id="candidateWidth">—</span></div>
            <div className="metric"><span className="k">尖端角</span><span className="v" id="candidateTipAngle">—</span></div>
            <div className="metric"><span className="k">RSTL 置信度</span><span className="v" id="directionConf">—</span></div>
            <div className="metric"><span className="k">面部分区</span><span className="v" id="regionVal">—</span></div>
            <div className="metric"><span className="k">Guardrails</span><span className="v" id="guardrailVal">—</span></div>
          </div>
          <p className="hint" id="llmSummary">尚未生成。</p>
          <p className="guardrail-details" id="directionSource">方向依据：尚未生成。</p>
          <p className="guardrail-details" id="agentGate">Agent 工具门控：尚未生成。</p>
          <p className="guardrail-details" id="agentComparison">Agent 候选比较：尚未生成。</p>
          <p className="hint" id="nextStep"></p>
          <p className="guardrail-details" id="guardrailDetails">Guardrails 尚未运行。</p>
        </div>

        <div className="card agent-grid">
          <div className="quality-top"><span>医生调整</span><span className="edit-status" id="editStatus">工具建议</span></div>
          <div>
            <label className="field-label" htmlFor="angleOffsetDeg">方向偏移 deg <span id="angleOffsetVal" className="val">0</span></label>
            <input id="angleOffsetDeg" type="range" min="-35" max="35" defaultValue="0" />
          </div>
          <div>
            <label className="field-label" htmlFor="lengthScale">长度比例 <span id="lengthScaleVal" className="val">100%</span></label>
            <input id="lengthScale" type="range" min="70" max="150" defaultValue="100" />
          </div>
          <div id="widthScaleWrap" className="hidden">
            <label className="field-label" htmlFor="widthScale">宽度比例 <span id="widthScaleVal" className="val">100%</span></label>
            <input id="widthScale" type="range" min="70" max="150" defaultValue="100" />
          </div>
          <div>
            <label className="field-label" htmlFor="shiftAlongMm">沿长轴移动 mm <span id="shiftAlongVal" className="val">0</span></label>
            <input id="shiftAlongMm" type="range" min="-12" max="12" defaultValue="0" />
          </div>
          <div>
            <label className="field-label" htmlFor="shiftPerpMm">垂直长轴移动 mm <span id="shiftPerpVal" className="val">0</span></label>
            <input id="shiftPerpMm" type="range" min="-12" max="12" defaultValue="0" />
          </div>
          <select id="editReason" className="select" defaultValue="">
            <option value="">未选择覆盖原因</option>
            <option value="manual scar camouflage">瘢痕隐蔽优先</option>
            <option value="manual free-margin protection">游离缘保护优先</option>
            <option value="manual subunit boundary alignment">贴合美学亚单位边界</option>
            <option value="manual clinician preference">医生人工判断</option>
          </select>
          <div className="btn-row two-cols">
            <button className="btn" id="undoEditBtn" type="button">撤销调整</button>
            <button className="btn" id="redoEditBtn" type="button">重做调整</button>
          </div>
          <button className="btn" id="resetEditBtn" type="button">恢复工具建议</button>
          <p className="agent-note" id="editHistoryState">编辑版本：v1 · 无已提交调整</p>
          <p className="agent-note">调整只改变候选草案并记录 provenance；真实切口仍需医生复核。</p>
        </div>

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
