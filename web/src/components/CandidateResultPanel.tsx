import { useIncisionStore, type IncisionResultViewState } from "../stores/incisionStore";

const DEFAULT_RESULT_VIEW: IncisionResultViewState = {
  candidateType: "—",
  candidateLength: "—",
  candidateWidth: "—",
  candidateTipAngle: "—",
  directionConfidence: "—",
  directionTitle: "",
  region: "—",
  regionTitle: "",
  guardrailLabel: "—",
  guardrailWarn: false,
  llmSummary: "尚未生成。",
  directionSource: "方向依据：尚未生成。",
  directionSourceWarn: false,
  agentGate: "Agent 工具门控：尚未生成。",
  agentGateWarn: false,
  agentGateTitle: "",
  agentComparison: "Agent 候选比较：尚未生成。",
  agentComparisonWarn: false,
  agentComparisonTitle: "",
  nextStep: "",
  guardrailDetails: "Guardrails 尚未运行。",
  guardrailDetailsWarn: false,
  guardrailDetailsDanger: false,
};

function detailTone(view: IncisionResultViewState) {
  if (view.guardrailDetailsDanger) return " danger";
  if (view.guardrailDetailsWarn) return " warn";
  return "";
}

export function CandidateResultPanel() {
  const view = useIncisionStore((state) => state.snapshot?.resultView) || DEFAULT_RESULT_VIEW;

  return (
    <div className="card">
      <div className="quality-top"><span>候选结果</span><span id="candidateType">{view.candidateType}</span></div>
      <div className="metric-grid">
        <div className="metric"><span className="k">长度</span><span className="v" id="candidateLength">{view.candidateLength}</span></div>
        <div className="metric"><span className="k">宽度 / 比例</span><span className="v" id="candidateWidth">{view.candidateWidth}</span></div>
        <div className="metric"><span className="k">尖端角</span><span className="v" id="candidateTipAngle">{view.candidateTipAngle}</span></div>
        <div className="metric">
          <span className="k">RSTL 置信度</span>
          <span className="v" id="directionConf" title={view.directionTitle}>{view.directionConfidence}</span>
        </div>
        <div className="metric">
          <span className="k">面部分区</span>
          <span className="v" id="regionVal" title={view.regionTitle}>{view.region}</span>
        </div>
        <div className="metric">
          <span className="k">Guardrails</span>
          <span className="v" id="guardrailVal" style={{ color: view.guardrailWarn ? "#b45309" : undefined }}>{view.guardrailLabel}</span>
        </div>
      </div>
      <p className="hint" id="llmSummary">{view.llmSummary}</p>
      <p className={`guardrail-details${view.directionSourceWarn ? " warn" : ""}`} id="directionSource">{view.directionSource}</p>
      <p className={`guardrail-details${view.agentGateWarn ? " warn" : ""}`} id="agentGate" title={view.agentGateTitle}>{view.agentGate}</p>
      <p className={`guardrail-details${view.agentComparisonWarn ? " warn" : ""}`} id="agentComparison" title={view.agentComparisonTitle}>
        {view.agentComparison}
      </p>
      <p className="hint" id="nextStep">{view.nextStep}</p>
      <p className={`guardrail-details${detailTone(view)}`} id="guardrailDetails">{view.guardrailDetails}</p>
    </div>
  );
}
