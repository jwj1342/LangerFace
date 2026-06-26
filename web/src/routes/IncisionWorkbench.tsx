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

        <SecondaryCuePanel />

        <ProviderConfigPanel />

        <CandidateResultPanel />

        <EditControlsPanel />

        <ReviewControlsPanel />

        <CandidateLibraryPanel />

        <PrivacyAuditPanel />

        <p className="disclaimer">⚠️ 研究原型：LLM 只做编排摘要，方向、几何和 guardrails 均由确定性工具输出。候选切口必须由医生审阅确认。</p>
      </aside>

      <IncisionStagePanel />
    </div>
  );
}
