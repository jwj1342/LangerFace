import { useEffect, useState } from "react";

import { dispatchControllerCommand } from "../lib/controllerCommand";
import { INCISION_SECONDARY_CUE_REACT_COMMAND_EVENT } from "../lib/controllerEvents";
import { useIncisionStore } from "../stores/incisionStore";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";

function dispatchSecondaryCueCommand(command: string) {
  dispatchControllerCommand(INCISION_SECONDARY_CUE_REACT_COMMAND_EVENT, { command });
}

export function SecondaryCuePanel() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const cue = snapshot?.secondaryCue;
  const [manualConfirmed, setManualConfirmed] = useState(false);

  useEffect(() => {
    setManualConfirmed(Boolean(cue?.manualConfirmed));
  }, [cue?.manualConfirmed]);

  return (
    <div className="card agent-grid">
      <div className="quality-top">
        <span>辅助线索</span>
        <span id="secondaryCueState">{cue?.stateLabel || "未导入"}</span>
      </div>
      <p className="agent-note" id="secondaryCueSummary">
        {cue?.summary || "仅展示自然皱襞、皱纹和皮表肿物边界的低置信度线索；不会自动改变肿物边界或候选切口。"}
      </p>
      <div className="btn-row two-cols">
        <Button variant="workbench" id="importSecondaryCueBtn" type="button" onClick={() => dispatchSecondaryCueCommand("import_secondary_cue")}>导入线索</Button>
        <Button variant="workbench" id="clearSecondaryCueBtn" type="button" disabled={!cue?.present} onClick={() => dispatchSecondaryCueCommand("clear_secondary_cue")}>清空线索</Button>
      </div>
      <Input id="secondaryCueImportFile" className="hidden" type="file" accept="application/json,.json" />
      <label className="check">
        <Checkbox
          id="secondaryCueConfirmed"
          checked={manualConfirmed}
          disabled={!cue?.present}
          onChange={(event) => {
            setManualConfirmed(event.currentTarget.checked);
            dispatchSecondaryCueCommand("secondary_cue_confirmed");
          }}
        /> 已人工确认辅助线索
      </label>
    </div>
  );
}
