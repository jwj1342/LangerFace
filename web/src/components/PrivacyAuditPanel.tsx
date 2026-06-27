import { useIncisionStore, type IncisionPrivacyAuditState } from "../stores/incisionStore";
import { Card, CardHeader } from "./ui/card";
import { PrivacyAuditMessage, PrivacyStateText } from "./ui/privacy-audit";

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
        <PrivacyStateText blocked={privacy.blocked} id="privacyState">{privacy.stateLabel}</PrivacyStateText>
      </CardHeader>
      <PrivacyAuditMessage blocked={privacy.blocked} id="privacyAudit">{privacy.message}</PrivacyAuditMessage>
    </Card>
  );
}
