import { Link } from "react-router-dom";

import { CandidateLibraryPanel } from "../components/CandidateLibraryPanel";
import { CandidateResultPanel } from "../components/CandidateResultPanel";
import { EditControlsPanel } from "../components/EditControlsPanel";
import { IncisionStatePanel } from "../components/IncisionStatePanel";
import { IncisionStagePanel } from "../components/IncisionStagePanel";
import { PrivacyAuditPanel } from "../components/PrivacyAuditPanel";
import { ProviderConfigPanel } from "../components/ProviderConfigPanel";
import { ReviewControlsPanel } from "../components/ReviewControlsPanel";
import { SecondaryCuePanel } from "../components/SecondaryCuePanel";
import { TumorInputPanel } from "../components/TumorInputPanel";
import { Disclaimer, WorkbenchLayout } from "../components/WorkbenchLayout";
import { WorkbenchBrand } from "../components/WorkbenchBrand";
import { StatusBadge } from "../components/ui/status-badge";

export function IncisionWorkbench() {
  return (
    <WorkbenchLayout
      className="incision-workbench"
      stage={<IncisionStagePanel />}
    >
      <WorkbenchBrand
        eyebrow="STAGE 2 · AGENTIC INCISION"
        title="切口 Agent 工作台"
        action={<StatusBadge asChild><Link to="/live">返回实时显示</Link></StatusBadge>}
      />

      <IncisionStatePanel />

      <TumorInputPanel />

      <SecondaryCuePanel />

      <ProviderConfigPanel />

      <CandidateResultPanel />

      <EditControlsPanel />

      <ReviewControlsPanel />

      <CandidateLibraryPanel />

      <PrivacyAuditPanel />

      <Disclaimer>⚠️ 研究原型：LLM 只做编排摘要，方向、几何和 guardrails 均由确定性工具输出。候选切口必须由医生审阅确认。</Disclaimer>
    </WorkbenchLayout>
  );
}
