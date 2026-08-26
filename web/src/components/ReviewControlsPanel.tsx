import { useEffect, useState } from "react";

import { Button } from "./ui/button";
import { WorkbenchCard, CardHeader } from "./ui/card";
import { WorkbenchNote } from "./ui/hint";
import { ReviewStatus } from "./ui/incision-status";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { useIncisionControllerCommands } from "../hooks/useControllerCommands";
import { reviewStatusLabel } from "../services/incisionClinicalCopy";
import { useIncisionStore } from "../stores/incisionStore";

function reviewLabel(status: string) {
  return reviewStatusLabel(status);
}

function reviewTone(status: string): "" | "approved" | "rejected" | "revision" {
  if (status === "rejected_by_clinician") return "rejected";
  if (status === "needs_revision") return "revision";
  return "";
}

function visibleReviewStatus(status: string) {
  return status === "approved_for_discussion"
    ? "approved_for_discussion"
    : "pending_clinician_confirmation";
}

export function ReviewControlsPanel() {
  const commands = useIncisionControllerCommands();
  const snapshot = useIncisionStore((state) => state.snapshot);
  const [status, setStatus] = useState("pending_clinician_confirmation");
  const [reviewer, setReviewer] = useState("");

  useEffect(() => {
    const next = snapshot?.review.status;
    if (next) setStatus(visibleReviewStatus(next));
  }, [snapshot?.review.status]);

  useEffect(() => {
    setReviewer(snapshot?.review.reviewer || "");
  }, [snapshot?.review.reviewer]);

  const reviewerAttentionRequired = Boolean(snapshot?.review.reviewerAttentionRequired && !reviewer.trim());
  const decisionAttentionRequired = Boolean(snapshot?.review.decisionAttentionRequired);
  const notesAttentionRequired = Boolean(snapshot?.review.notesAttentionRequired && !snapshot.review.notesPresent);

  return (
    <WorkbenchCard>
      <CardHeader>
        <span>医生审阅</span>
        <ReviewStatus tone={reviewTone(status)} id="reviewState">{reviewLabel(status)}</ReviewStatus>
      </CardHeader>
      <div>
        <Label htmlFor="reviewerName">审阅人</Label>
        <Input
          id="reviewerName"
          placeholder="请输入审阅人"
          value={reviewer}
          onChange={(event) => setReviewer(event.currentTarget.value)}
          className={reviewerAttentionRequired ? "workflow-review-attention" : undefined}
          aria-invalid={reviewerAttentionRequired}
          aria-describedby={reviewerAttentionRequired ? "workflowStageStatus" : undefined}
        />
      </div>
      <Select
        id="reviewDecision"
        value={status}
        className={decisionAttentionRequired ? "workflow-review-attention" : undefined}
        aria-invalid={decisionAttentionRequired}
        aria-describedby={decisionAttentionRequired ? "workflowStageStatus" : undefined}
        onChange={(event) => {
          setStatus(event.currentTarget.value);
          commands.review("review_state_changed");
        }}
      >
        <option value="pending_clinician_confirmation">待医生确认</option>
        <option value="approved_for_discussion">确认候选草案</option>
      </Select>
      <Textarea
        id="reviewNotes"
        placeholder="普通待确认可留空；红色阻断或高风险确认必须填写"
        className={notesAttentionRequired ? "workflow-review-attention" : undefined}
        aria-invalid={notesAttentionRequired}
        aria-describedby={notesAttentionRequired ? "workflowStageStatus" : undefined}
      />
      <Button
        variant="workbenchPrimary"
        id="saveReviewBtn"
        type="button"
        onClick={() => commands.review("save_review")}
      >
        保存所选审阅状态
      </Button>
      <WorkbenchNote>“已确认研究候选”只表示已完成本次研究审阅，不是手术指令。候选形状一旦调整，状态会自动回到“待医生确认”。视野受限或比例不标准的结果只能保存为待确认记录，不能直接显示到实时画面。</WorkbenchNote>
    </WorkbenchCard>
  );
}
