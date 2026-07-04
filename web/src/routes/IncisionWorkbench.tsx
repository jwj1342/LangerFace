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
      stage={<IncisionStagePanel />}
      workspace="incision"
    >
      <WorkbenchBrand
        eyebrow="病例步骤二 · 切口规划"
        title="切口规划与候选审阅"
        action={<StatusBadge asChild><Link to="/cases">返回病例大厅</Link></StatusBadge>}
      />

      <IncisionStatePanel />

      <TumorInputPanel />

      <SecondaryCuePanel />

      <details className="clinical-developer-disclosure">
        <summary>开发者配置</summary>
        <ProviderConfigPanel />
      </details>

      <CandidateResultPanel />

      <EditControlsPanel />

      <ReviewControlsPanel />

      <CandidateLibraryPanel />

      <PrivacyAuditPanel />

      <Disclaimer>临床辅助设计：候选切口由规则工具生成，仅供执业医师结合查体审阅确认；不替代最终手术决策。</Disclaimer>
    </WorkbenchLayout>
  );
}
