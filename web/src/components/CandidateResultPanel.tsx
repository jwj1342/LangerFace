import { useIncisionStore, type IncisionResultViewState } from "../stores/incisionStore";
import { Card, CardHeader } from "./ui/card";
import { HelpDisclosure } from "./ui/help-disclosure";
import { Hint } from "./ui/hint";
import { GuardrailDetails } from "./ui/incision-feedback";
import { MetricGrid, MetricItem } from "./ui/key-value";

const DEFAULT_RESULT_VIEW: IncisionResultViewState = {
  candidateType: "—",
  candidateLength: "—",
  candidateWidth: "—",
  candidateTipAngle: "—",
  rstlDeviation: "—",
  directionConfidence: "—",
  directionTitle: "",
  region: "—",
  regionTitle: "",
  guardrailLabel: "—",
  guardrailWarn: false,
  workflowSummary: "尚未生成。",
  directionSource: "方向依据：尚未生成。",
  directionSourceWarn: false,
  workflowGate: "工作流工具门控：尚未生成。",
  workflowGateWarn: false,
  workflowGateTitle: "",
  workflowComparison: "工作流候选比较：尚未生成。",
  workflowComparisonWarn: false,
  workflowComparisonTitle: "",
  nextStep: "",
  guardrailDetails: "保护规则尚未运行。",
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
        <MetricItem label="RSTL 角度偏差" value={view.rstlDeviation} valueProps={{ id: "candidateRstlDeviation" }} />
        <MetricItem
          label="RSTL 置信度"
          value={view.directionConfidence}
          valueProps={{ id: "directionConf", title: view.directionTitle }}
        />
        <MetricItem label="面部分区" value={view.region} valueProps={{ id: "regionVal", title: view.regionTitle }} />
        <MetricItem
          label="保护规则"
          value={view.guardrailLabel}
          valueProps={{ id: "guardrailVal", style: { color: view.guardrailWarn ? "#b45309" : undefined } }}
        />
      </MetricGrid>
      <Hint id="workflowSummary">{view.workflowSummary}</Hint>
      <Hint id="nextStep">{view.nextStep}</Hint>
      <GuardrailDetails tone={detailTone(view)} id="guardrailDetails">{view.guardrailDetails}</GuardrailDetails>
      <HelpDisclosure className="incision-technical-details" open={false} title="技术详情与审计 trace">
        <GuardrailDetails tone={view.directionSourceWarn ? "warn" : "neutral"} id="directionSource">{view.directionSource}</GuardrailDetails>
        <GuardrailDetails tone={view.workflowGateWarn ? "warn" : "neutral"} id="workflowGate" title={view.workflowGateTitle}>{view.workflowGate}</GuardrailDetails>
        <GuardrailDetails tone={view.workflowComparisonWarn ? "warn" : "neutral"} id="workflowComparison" title={view.workflowComparisonTitle}>
          {view.workflowComparison}
        </GuardrailDetails>
      </HelpDisclosure>
    </Card>
  );
}
