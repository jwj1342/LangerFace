export type SurgeryVerdictTone = "neutral" | "ok" | "warn";

interface SurgeryMetricsPanelProps {
  tensionScore: number | null;
  verdict: string;
  verdictTone: SurgeryVerdictTone;
}

export function SurgeryMetricsPanel({ tensionScore, verdict, verdictTone }: SurgeryMetricsPanelProps) {
  return (
    <div className="card">
      <div className="quality-top"><span>闭合新增张力</span><span><b id="tensionVal">{tensionScore ?? "—"}</b> / 100</span></div>
      <div className="bar">
        <div
          className="bar-fill surgery-tension-bar"
          id="tensionBar"
          style={{ width: `${Math.max(0, Math.min(100, tensionScore ?? 0))}%` }}
        />
      </div>
      <div className="legend">
        <span className="legend-sw surgery-legend-skin" />无新增（平和）
        <span className="legend-sw surgery-legend-red" />闭合新增张力升高
      </div>
      <p className={`hint surgery-verdict-${verdictTone}`} id="verdict">{verdict}</p>
    </div>
  );
}
