import { CandidateLibraryPanel } from "./CandidateLibraryPanel";
import { CandidateResultPanel } from "./CandidateResultPanel";
import { PrivacyAuditPanel } from "./PrivacyAuditPanel";
import { ReviewControlsPanel } from "./ReviewControlsPanel";
import { SecondaryCuePanel } from "./SecondaryCuePanel";
import { TumorInputPanel } from "./TumorInputPanel";
import { WorkbenchBrand } from "./WorkbenchBrand";
import { Disclaimer } from "./WorkbenchLayout";
import { StatusBadge } from "./ui/status-badge";

export function WorkflowIncisionRail() {
  return (
    <>
      <WorkbenchBrand
        eyebrow="切口研究工具"
        title="切口规划与候选审阅"
        action={<StatusBadge>单页工作流</StatusBadge>}
      />
      <TumorInputPanel showDepthControl={false} />
      <SecondaryCuePanel />
      <CandidateResultPanel showWorkflowGuidance={false} />
      <ReviewControlsPanel />
      <CandidateLibraryPanel automaticOverlay showHandoffStatus={false} />
      <PrivacyAuditPanel />
      <Disclaimer>临床辅助设计：候选切口由规则工具生成，仅供执业医师结合查体审阅确认；不替代最终手术决策。</Disclaimer>
    </>
  );
}
