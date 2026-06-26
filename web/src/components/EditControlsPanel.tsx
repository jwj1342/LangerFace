import { useEffect, useState } from "react";

import { dispatchIncisionEditCommand } from "../lib/controllerCommand";
import { useIncisionStore } from "../stores/incisionStore";
import { Button } from "./ui/button";
import { Card, CardHeader } from "./ui/card";
import { Label } from "./ui/label";
import { Select } from "./ui/select";
import { RangeInput } from "./ui/slider";

const DEFAULT_EDIT_STATE = {
  angleOffsetDeg: 0,
  lengthScalePct: 100,
  widthScalePct: 100,
  shiftAlongMm: 0,
  shiftPerpMm: 0,
  reason: "",
  statusLabel: "工具建议",
  active: false,
  widthScaleVisible: false,
  historyLabel: "编辑版本：v1 · 无已提交调整",
  undoDisabled: true,
  redoDisabled: true,
};

export function EditControlsPanel() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const [angleOffsetDeg, setAngleOffsetDeg] = useState(String(DEFAULT_EDIT_STATE.angleOffsetDeg));
  const [lengthScalePct, setLengthScalePct] = useState(String(DEFAULT_EDIT_STATE.lengthScalePct));
  const [widthScalePct, setWidthScalePct] = useState(String(DEFAULT_EDIT_STATE.widthScalePct));
  const [shiftAlongMm, setShiftAlongMm] = useState(String(DEFAULT_EDIT_STATE.shiftAlongMm));
  const [shiftPerpMm, setShiftPerpMm] = useState(String(DEFAULT_EDIT_STATE.shiftPerpMm));
  const [reason, setReason] = useState(DEFAULT_EDIT_STATE.reason);
  const [statusLabel, setStatusLabel] = useState(DEFAULT_EDIT_STATE.statusLabel);
  const [active, setActive] = useState(DEFAULT_EDIT_STATE.active);
  const [widthScaleVisible, setWidthScaleVisible] = useState(DEFAULT_EDIT_STATE.widthScaleVisible);
  const [historyLabel, setHistoryLabel] = useState(DEFAULT_EDIT_STATE.historyLabel);
  const [undoDisabled, setUndoDisabled] = useState(DEFAULT_EDIT_STATE.undoDisabled);
  const [redoDisabled, setRedoDisabled] = useState(DEFAULT_EDIT_STATE.redoDisabled);

  useEffect(() => {
    const edit = snapshot?.edit;
    if (!edit) return;
    setAngleOffsetDeg(String(edit.angleOffsetDeg));
    setLengthScalePct(String(edit.lengthScalePct));
    setWidthScalePct(String(edit.widthScalePct));
    setShiftAlongMm(String(edit.shiftAlongMm));
    setShiftPerpMm(String(edit.shiftPerpMm));
    setReason(edit.reason || "");
    setStatusLabel(edit.statusLabel || DEFAULT_EDIT_STATE.statusLabel);
    setActive(Boolean(edit.active));
    setWidthScaleVisible(Boolean(edit.widthScaleVisible));
    setHistoryLabel(edit.historyLabel || DEFAULT_EDIT_STATE.historyLabel);
    setUndoDisabled(Boolean(edit.undoDisabled));
    setRedoDisabled(Boolean(edit.redoDisabled));
  }, [snapshot?.edit]);

  const preview = () => dispatchIncisionEditCommand("preview_edit");
  const commit = () => dispatchIncisionEditCommand("commit_edit");

  return (
    <Card className="agent-grid">
      <CardHeader>
        <span>医生调整</span>
        <span className={`edit-status${active ? " active" : ""}`} id="editStatus">{statusLabel}</span>
      </CardHeader>
      <div>
        <Label htmlFor="angleOffsetDeg">方向偏移 deg <span id="angleOffsetVal" className="val">{angleOffsetDeg}</span></Label>
        <RangeInput
          id="angleOffsetDeg"
          min="-35"
          max="35"
          value={angleOffsetDeg}
          onInput={(event) => {
            setAngleOffsetDeg(event.currentTarget.value);
            preview();
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          onChange={(event) => setAngleOffsetDeg(event.currentTarget.value)}
        />
      </div>
      <div>
        <Label htmlFor="lengthScale">长度比例 <span id="lengthScaleVal" className="val">{lengthScalePct}%</span></Label>
        <RangeInput
          id="lengthScale"
          min="70"
          max="150"
          value={lengthScalePct}
          onInput={(event) => {
            setLengthScalePct(event.currentTarget.value);
            preview();
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          onChange={(event) => setLengthScalePct(event.currentTarget.value)}
        />
      </div>
      <div id="widthScaleWrap" className={widthScaleVisible ? "" : "hidden"}>
        <Label htmlFor="widthScale">宽度比例 <span id="widthScaleVal" className="val">{widthScalePct}%</span></Label>
        <RangeInput
          id="widthScale"
          min="70"
          max="150"
          value={widthScalePct}
          onInput={(event) => {
            setWidthScalePct(event.currentTarget.value);
            preview();
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          onChange={(event) => setWidthScalePct(event.currentTarget.value)}
        />
      </div>
      <div>
        <Label htmlFor="shiftAlongMm">沿长轴移动 mm <span id="shiftAlongVal" className="val">{shiftAlongMm}</span></Label>
        <RangeInput
          id="shiftAlongMm"
          min="-12"
          max="12"
          value={shiftAlongMm}
          onInput={(event) => {
            setShiftAlongMm(event.currentTarget.value);
            preview();
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          onChange={(event) => setShiftAlongMm(event.currentTarget.value)}
        />
      </div>
      <div>
        <Label htmlFor="shiftPerpMm">垂直长轴移动 mm <span id="shiftPerpVal" className="val">{shiftPerpMm}</span></Label>
        <RangeInput
          id="shiftPerpMm"
          min="-12"
          max="12"
          value={shiftPerpMm}
          onInput={(event) => {
            setShiftPerpMm(event.currentTarget.value);
            preview();
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          onChange={(event) => setShiftPerpMm(event.currentTarget.value)}
        />
      </div>
      <Select
        id="editReason"
        value={reason}
        onChange={(event) => {
          setReason(event.currentTarget.value);
          dispatchIncisionEditCommand("commit_reason");
        }}
      >
        <option value="">未选择覆盖原因</option>
        <option value="manual scar camouflage">瘢痕隐蔽优先</option>
        <option value="manual free-margin protection">游离缘保护优先</option>
        <option value="manual subunit boundary alignment">贴合美学亚单位边界</option>
        <option value="manual clinician preference">医生人工判断</option>
      </Select>
      <div className="btn-row two-cols">
        <Button variant="workbench" id="undoEditBtn" type="button" disabled={undoDisabled} onClick={() => dispatchIncisionEditCommand("undo_edit")}>撤销调整</Button>
        <Button variant="workbench" id="redoEditBtn" type="button" disabled={redoDisabled} onClick={() => dispatchIncisionEditCommand("redo_edit")}>重做调整</Button>
      </div>
      <Button variant="workbench" id="resetEditBtn" type="button" onClick={() => dispatchIncisionEditCommand("reset_edit")}>恢复工具建议</Button>
      <p className="agent-note" id="editHistoryState">{historyLabel}</p>
      <p className="agent-note">调整只改变候选草案并记录 provenance；真实切口仍需医生复核。</p>
    </Card>
  );
}
