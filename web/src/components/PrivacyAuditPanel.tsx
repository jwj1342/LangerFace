import { useIncisionStore, type IncisionPrivacyAuditState } from "../stores/incisionStore";
import { Card, CardHeader } from "./ui/card";

const DEFAULT_PRIVACY_AUDIT: IncisionPrivacyAuditState = {
  stateLabel: "本地几何",
  message: "不上传原始影像；Agent 只接收肿物参数、抽象坐标、规则和候选几何。",
  blocked: false,
};

export function PrivacyAuditPanel() {
  const privacy = useIncisionStore((state) => state.snapshot?.privacyAudit) || DEFAULT_PRIVACY_AUDIT;

  return (
    <Card>
      <CardHeader>
        <span>隐私 / 审计</span>
        <span id="privacyState" className={privacy.blocked ? "danger-text" : undefined}>{privacy.stateLabel}</span>
      </CardHeader>
      <p className={`hint${privacy.blocked ? " danger-text" : ""}`} id="privacyAudit">{privacy.message}</p>
    </Card>
  );
}
