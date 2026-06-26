import { useIncisionStore, type IncisionResultViewState } from "../stores/incisionStore";
import { Card, CardHeader } from "./ui/card";
import { Hint } from "./ui/hint";
import { GuardrailDetails } from "./ui/incision-feedback";
import { MetricGrid, MetricItem } from "./ui/key-value";

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

function detailTone(view: IncisionResultViewState): "neutral" | "warn" | "danger" {
  if (view.guardrailDetailsDanger) return "danger";
  if (view.guardrailDetailsWarn) return "warn";
  return "neutral";
}

export function CandidateResultPanel() {
  const view = useIncisionStore((state) => state.snapshot?.resultView) || DEFAULT_RESULT_VIEW;

  return (
    <Card>
      <CardHeader><span>候选结果</span><span id="candidateType">{view.candidateType}</span></CardHeader>
      <MetricGrid>
        <MetricItem label="长度" value={view.candidateLength} valueProps={{ id: "candidateLength" }} />
        <MetricItem label="宽度 / 比例" value={view.candidateWidth} valueProps={{ id: "candidateWidth" }} />
        <MetricItem label="尖端角" value={view.candidateTipAngle} valueProps={{ id: "candidateTipAngle" }} />
        <MetricItem
          label="RSTL 置信度"
          value={view.directionConfidence}
          valueProps={{ id: "directionConf", title: view.directionTitle }}
        />
        <MetricItem label="面部分区" value={view.region} valueProps={{ id: "regionVal", title: view.regionTitle }} />
        <MetricItem
          label="Guardrails"
          value={view.guardrailLabel}
          valueProps={{ id: "guardrailVal", style: { color: view.guardrailWarn ? "#b45309" : undefined } }}
        />
      </MetricGrid>
      <Hint id="llmSummary">{view.llmSummary}</Hint>
      <GuardrailDetails tone={view.directionSourceWarn ? "warn" : "neutral"} id="directionSource">{view.directionSource}</GuardrailDetails>
      <GuardrailDetails tone={view.agentGateWarn ? "warn" : "neutral"} id="agentGate" title={view.agentGateTitle}>{view.agentGate}</GuardrailDetails>
      <GuardrailDetails tone={view.agentComparisonWarn ? "warn" : "neutral"} id="agentComparison" title={view.agentComparisonTitle}>
        {view.agentComparison}
      </GuardrailDetails>
      <Hint id="nextStep">{view.nextStep}</Hint>
      <GuardrailDetails tone={detailTone(view)} id="guardrailDetails">{view.guardrailDetails}</GuardrailDetails>
    </Card>
  );
}
