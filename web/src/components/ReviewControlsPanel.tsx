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
  if (status === "approved_for_discussion") return "approved";
  if (status === "rejected_by_clinician") return "rejected";
  if (status === "needs_revision") return "revision";
  return "";
}

export function ReviewControlsPanel() {
  const commands = useIncisionControllerCommands();
  const snapshot = useIncisionStore((state) => state.snapshot);
  const [status, setStatus] = useState("pending_clinician_confirmation");

  useEffect(() => {
    const next = snapshot?.review.status;
    if (next) setStatus(next);
  }, [snapshot?.review.status]);

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
          placeholder="clinician reviewer"
          defaultValue={snapshot?.review.reviewer || ""}
        />
      </div>
      <Select
        id="reviewDecision"
        value={status}
        onChange={(event) => {
          setStatus(event.currentTarget.value);
          commands.review("review_state_changed");
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
      <Button
        variant="workbenchPrimary"
        id="saveReviewBtn"
        type="button"
        onClick={() => commands.review("save_review")}
      >
        保存所选审阅状态
      </Button>
      <WorkbenchNote>确认只代表进入研究审阅记录，不是手术指令；候选几何一旦调整，审阅状态会回到待确认。非标准比例参考需记录皮肤松弛度及自然对合情况；视野受限参考需补充另一视角并复核隐藏区域。两类结果均只保存为待确认草案，不进入实时叠加。</WorkbenchNote>
    </WorkbenchCard>
  );
}
