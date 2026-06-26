import { Card, CardHeader } from "./ui/card";
import { Legend, LegendSwatch } from "./ui/legend";
import { ProgressBar } from "./ui/progress";
import { SurgeryVerdict, type SurgeryVerdictTone } from "./ui/surgery-feedback";

export type { SurgeryVerdictTone } from "./ui/surgery-feedback";

interface SurgeryMetricsPanelProps {
  tensionScore: number | null;
  verdict: string;
  verdictTone: SurgeryVerdictTone;
}

export function SurgeryMetricsPanel({ tensionScore, verdict, verdictTone }: SurgeryMetricsPanelProps) {
  return (
    <Card>
      <CardHeader><span>闭合新增张力</span><span><b id="tensionVal">{tensionScore ?? "—"}</b> / 100</span></CardHeader>
      <ProgressBar fillClassName="surgery-tension-bar" fillProps={{ id: "tensionBar" }} value={tensionScore ?? 0} />
      <Legend>
        <LegendSwatch className="surgery-legend-skin" />无新增（平和）
        <LegendSwatch className="surgery-legend-red" />闭合新增张力升高
      </Legend>
      <SurgeryVerdict tone={verdictTone} id="verdict">{verdict}</SurgeryVerdict>
    </Card>
  );
}
