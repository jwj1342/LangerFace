import { Activity } from "lucide-react";

import { useIncisionStore } from "../stores/incisionStore";
import {
  candidateTypeLabel,
  reviewStatusLabel,
  rulesReviewLabel,
  tumorKindLabel,
} from "../services/incisionClinicalCopy";
import { DEFAULT_RULES } from "../services/incisionToolRules";
import { Card, CardHeader, CardHeaderTitle } from "./ui/card";
import { Hint } from "./ui/hint";
import { KeyValueGrid, KeyValueItem } from "./ui/key-value";

function formatRuntime(snapshot: ReturnType<typeof useIncisionStore.getState>["snapshot"]) {
  if (!snapshot?.workflowRuntime) return "未运行";
  if (snapshot.workflowRuntime.worker) return "Worker";
  return snapshot.workflowRuntime.executor || "fallback";
}

function formatModelVersion(snapshot: ReturnType<typeof useIncisionStore.getState>["snapshot"]) {
  const topologyId = snapshot?.headAsset.topologyId || "";
  if (topologyId === "flame-2023") return "高精度三维预览";
  if (topologyId === "mediapipe-468") return "标准三维模型";
  return "待识别";
}

export function IncisionStatePanel() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const candidate = snapshot?.candidate;

  return (
    <Card className="incision-state-panel">
      <CardHeader>
        <CardHeaderTitle><Activity size={14} /> 工作台状态</CardHeaderTitle>
        <span>{formatRuntime(snapshot)}</span>
      </CardHeader>
      <KeyValueGrid className="incision-state-grid">
        <KeyValueItem label="头模" value={snapshot?.headAsset.statusLabel || "加载中"} />
        <KeyValueItem label="模型版本" value={formatModelVersion(snapshot)} />
        <KeyValueItem label="肿物" value={snapshot ? `${tumorKindLabel(snapshot.tumor.kind)} · ${snapshot.tumor.diameterMm ?? "—"} mm` : "—"} />
        <KeyValueItem label="候选" value={candidate ? `${candidateTypeLabel(candidate.type)} · ${candidate.lengthMm?.toFixed(1) ?? "—"} mm` : "—"} />
        <KeyValueItem label="执行模式" value="本地确定性 workflow" />
        <KeyValueItem label="审阅" value={reviewStatusLabel(snapshot?.review.status)} />
        <KeyValueItem
          label="规则版本"
          value={`v${DEFAULT_RULES.version.split("-")[0]}`}
          valueProps={{ title: DEFAULT_RULES.version }}
        />
        <KeyValueItem label="验证状态" value="研究草案" />
      </KeyValueGrid>
      <Hint className="incision-rule-warning">
        {rulesReviewLabel(DEFAULT_RULES.review_status)}；最近规则复核：{DEFAULT_RULES.last_reviewed_at}。
      </Hint>
      {snapshot?.headAsset.warnings.length ? (
        <Hint>{snapshot.headAsset.warnings.join("；")}</Hint>
      ) : null}
      <Hint>{snapshot?.stageStatus || "正在等待 controller 发布状态。"}</Hint>
    </Card>
  );
}
