import { useEffect, useState } from "react";

import { dispatchIncisionSecondaryCueCommand } from "../lib/controllerCommand";
import { useIncisionStore } from "../stores/incisionStore";
import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { Card, CardHeader } from "./ui/card";
import { CheckboxField } from "./ui/checkbox-field";
import { AgentNote } from "./ui/hint";
import { Input } from "./ui/input";

export function SecondaryCuePanel() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const cue = snapshot?.secondaryCue;
  const [manualConfirmed, setManualConfirmed] = useState(false);

  useEffect(() => {
    setManualConfirmed(Boolean(cue?.manualConfirmed));
  }, [cue?.manualConfirmed]);

  return (
    <Card className="agent-grid">
      <CardHeader>
        <span>辅助线索</span>
        <span id="secondaryCueState">{cue?.stateLabel || "未导入"}</span>
      </CardHeader>
      <AgentNote id="secondaryCueSummary">
        {cue?.summary || "仅展示自然皱襞、皱纹和皮表肿物边界的低置信度线索；不会自动改变肿物边界或候选切口。"}
      </AgentNote>
      <ButtonRow className="two-cols">
        <Button variant="workbench" id="importSecondaryCueBtn" type="button" onClick={() => dispatchIncisionSecondaryCueCommand("import_secondary_cue")}>导入线索</Button>
        <Button variant="workbench" id="clearSecondaryCueBtn" type="button" disabled={!cue?.present} onClick={() => dispatchIncisionSecondaryCueCommand("clear_secondary_cue")}>清空线索</Button>
      </ButtonRow>
      <Input id="secondaryCueImportFile" hidden type="file" accept="application/json,.json" />
      <CheckboxField
        checkboxProps={{
          id: "secondaryCueConfirmed",
          checked: manualConfirmed,
          disabled: !cue?.present,
          onChange: (event) => {
            setManualConfirmed(event.currentTarget.checked);
            dispatchIncisionSecondaryCueCommand("secondary_cue_confirmed");
          },
        }}
      >
        已人工确认辅助线索
      </CheckboxField>
    </Card>
  );
}
