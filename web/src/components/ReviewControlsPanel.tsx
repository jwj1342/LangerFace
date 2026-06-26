import { useEffect, useState } from "react";

import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { Card, CardHeader } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { dispatchIncisionReviewCommand } from "../lib/controllerCommand";
import { useIncisionStore } from "../stores/incisionStore";

const REVIEW_LABELS: Record<string, string> = {
  pending_clinician_confirmation: "待医生确认",
  approved_for_discussion: "确认候选草案",
  needs_revision: "退回修改",
  rejected_by_clinician: "否决候选",
};

function reviewLabel(status: string) {
  return REVIEW_LABELS[status] || REVIEW_LABELS.pending_clinician_confirmation;
}

function reviewTone(status: string) {
  if (status === "approved_for_discussion") return "approved";
  if (status === "rejected_by_clinician") return "rejected";
  if (status === "needs_revision") return "revision";
  return "";
}

export function ReviewControlsPanel() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const [status, setStatus] = useState("pending_clinician_confirmation");

  useEffect(() => {
    const next = snapshot?.review.status;
    if (next) setStatus(next);
  }, [snapshot?.review.status]);

  return (
    <Card className="agent-grid">
      <CardHeader>
        <span>医生审阅</span>
        <span className={`review-state ${reviewTone(status)}`} id="reviewState">{reviewLabel(status)}</span>
      </CardHeader>
      <div>
        <Label htmlFor="reviewerName">审阅人</Label>
        <Input
          id="reviewerName"
          placeholder="clinician reviewer"
          defaultValue={snapshot?.review.reviewer || ""}
        />
      </div>
      <Select
        id="reviewDecision"
        defaultValue="pending_clinician_confirmation"
        onChange={(event) => {
          setStatus(event.currentTarget.value);
          dispatchIncisionReviewCommand("review_state_changed");
        }}
      >
        <option value="pending_clinician_confirmation">待医生确认</option>
        <option value="approved_for_discussion">确认候选草案</option>
        <option value="needs_revision">退回修改</option>
        <option value="rejected_by_clinician">否决候选</option>
      </Select>
      <Textarea
        id="reviewNotes"
        placeholder="审阅备注、覆盖原因或需要回看的位置"
      />
      <ButtonRow className="two-cols">
        <Button
          variant="workbench"
          id="approveCandidateBtn"
          type="button"
          onClick={() => dispatchIncisionReviewCommand("approve_candidate")}
        >
          确认当前候选
        </Button>
        <Button
          variant="workbench"
          id="rejectCandidateBtn"
          type="button"
          onClick={() => dispatchIncisionReviewCommand("reject_candidate")}
        >
          否决当前候选
        </Button>
      </ButtonRow>
      <Button
        variant="workbenchPrimary"
        id="saveReviewBtn"
        type="button"
        onClick={() => dispatchIncisionReviewCommand("save_review")}
      >
        保存审阅记录
      </Button>
      <p className="agent-note">确认只代表进入研究审阅记录，不是手术指令；候选几何一旦调整，审阅状态会回到待确认。</p>
    </Card>
  );
}
