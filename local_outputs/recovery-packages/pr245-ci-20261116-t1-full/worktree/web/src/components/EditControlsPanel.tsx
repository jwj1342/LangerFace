import { useEffect, useState } from "react";

import { useIncisionControllerCommands } from "../hooks/useControllerCommands";
import type { IncisionEditControlId } from "../lib/controllerCommand";
import { useIncisionStore } from "../stores/incisionStore";
import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { WorkbenchCard, CardHeader } from "./ui/card";
import { FieldGroup } from "./ui/field-group";
import { WorkbenchNote } from "./ui/hint";
import { EditStatus } from "./ui/incision-status";
import { FieldValue, Label } from "./ui/label";
import { Select } from "./ui/select";
import { RangeInput } from "./ui/slider";

const DEFAULT_EDIT_STATE = {
  angleOffsetDeg: 0,
  lengthScalePct: 100,
  widthScalePct: 100,
  tipAngleDeg: 30,
  shiftAlongMm: 0,
  shiftPerpMm: 0,
  reason: "",
  statusLabel: "工具建议",
  active: false,
  widthScaleVisible: false,
  tipAngleVisible: false,
  historyLabel: "编辑版本：v1 · 无已提交调整",
  undoDisabled: true,
  redoDisabled: true,
};

export function EditControlsPanel() {
  const commands = useIncisionControllerCommands();
  const snapshot = useIncisionStore((state) => state.snapshot);
  const [angleOffsetDeg, setAngleOffsetDeg] = useState(String(DEFAULT_EDIT_STATE.angleOffsetDeg));
  const [lengthScalePct, setLengthScalePct] = useState(String(DEFAULT_EDIT_STATE.lengthScalePct));
  const [widthScalePct, setWidthScalePct] = useState(String(DEFAULT_EDIT_STATE.widthScalePct));
  const [tipAngleDeg, setTipAngleDeg] = useState(String(DEFAULT_EDIT_STATE.tipAngleDeg));
  const [shiftAlongMm, setShiftAlongMm] = useState(String(DEFAULT_EDIT_STATE.shiftAlongMm));
  const [shiftPerpMm, setShiftPerpMm] = useState(String(DEFAULT_EDIT_STATE.shiftPerpMm));
  const [reason, setReason] = useState(DEFAULT_EDIT_STATE.reason);
  const [statusLabel, setStatusLabel] = useState(DEFAULT_EDIT_STATE.statusLabel);
  const [active, setActive] = useState(DEFAULT_EDIT_STATE.active);
  const [widthScaleVisible, setWidthScaleVisible] = useState(DEFAULT_EDIT_STATE.widthScaleVisible);
  const [tipAngleVisible, setTipAngleVisible] = useState(DEFAULT_EDIT_STATE.tipAngleVisible);
  const [historyLabel, setHistoryLabel] = useState(DEFAULT_EDIT_STATE.historyLabel);
  const [undoDisabled, setUndoDisabled] = useState(DEFAULT_EDIT_STATE.undoDisabled);
  const [redoDisabled, setRedoDisabled] = useState(DEFAULT_EDIT_STATE.redoDisabled);

  useEffect(() => {
    const edit = snapshot?.edit;
    if (!edit) return;
    setAngleOffsetDeg(String(edit.angleOffsetDeg));
    setLengthScalePct(String(edit.lengthScalePct));
    setWidthScalePct(String(edit.widthScalePct));
    setTipAngleDeg(String(edit.tipAngleDeg));
    setShiftAlongMm(String(edit.shiftAlongMm));
    setShiftPerpMm(String(edit.shiftPerpMm));
    setReason(edit.reason || "");
    setStatusLabel(edit.statusLabel || DEFAULT_EDIT_STATE.statusLabel);
    setActive(Boolean(edit.active));
    setWidthScaleVisible(Boolean(edit.widthScaleVisible));
    setTipAngleVisible(Boolean(edit.tipAngleVisible));
    setHistoryLabel(edit.historyLabel || DEFAULT_EDIT_STATE.historyLabel);
    setUndoDisabled(Boolean(edit.undoDisabled));
    setRedoDisabled(Boolean(edit.redoDisabled));
  }, [snapshot?.edit]);

  const preview = (controlId: IncisionEditControlId, value: string) => {
    commands.edit("preview_edit", controlId, value);
  };
  const commit = (controlId: IncisionEditControlId, value: string) => {
    commands.edit("commit_edit", controlId, value);
  };

  return (
    <WorkbenchCard>
      <CardHeader>
        <span>医生调整</span>
        <EditStatus active={active} id="editStatus">{statusLabel}</EditStatus>
      </CardHeader>
      <FieldGroup>
        <Label htmlFor="angleOffsetDeg">方向偏移 deg <FieldValue id="angleOffsetVal">{angleOffsetDeg}</FieldValue></Label>
        <RangeInput
          id="angleOffsetDeg"
          min="-35"
          max="35"
          value={angleOffsetDeg}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setAngleOffsetDeg(value);
            preview("angleOffsetDeg", value);
          }}
          onPointerUp={(event) => commit("angleOffsetDeg", event.currentTarget.value)}
          onKeyUp={(event) => commit("angleOffsetDeg", event.currentTarget.value)}
          onBlur={(event) => commit("angleOffsetDeg", event.currentTarget.value)}
          onChange={(event) => setAngleOffsetDeg(event.currentTarget.value)}
        />
      </FieldGroup>
      <FieldGroup>
        <Label htmlFor="lengthScale">长度比例 <FieldValue id="lengthScaleVal">{lengthScalePct}%</FieldValue></Label>
        <RangeInput
          id="lengthScale"
          min="70"
          max="150"
          value={lengthScalePct}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setLengthScalePct(value);
            preview("lengthScale", value);
          }}
          onPointerUp={(event) => commit("lengthScale", event.currentTarget.value)}
          onKeyUp={(event) => commit("lengthScale", event.currentTarget.value)}
          onBlur={(event) => commit("lengthScale", event.currentTarget.value)}
          onChange={(event) => setLengthScalePct(event.currentTarget.value)}
        />
      </FieldGroup>
      <FieldGroup id="widthScaleWrap" visible={widthScaleVisible}>
        <Label htmlFor="widthScale">宽度比例 <FieldValue id="widthScaleVal">{widthScalePct}%</FieldValue></Label>
        <RangeInput
          id="widthScale"
          min="70"
          max="150"
          value={widthScalePct}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setWidthScalePct(value);
            preview("widthScale", value);
          }}
          onPointerUp={(event) => commit("widthScale", event.currentTarget.value)}
          onKeyUp={(event) => commit("widthScale", event.currentTarget.value)}
          onBlur={(event) => commit("widthScale", event.currentTarget.value)}
          onChange={(event) => setWidthScalePct(event.currentTarget.value)}
        />
      </FieldGroup>
      <FieldGroup id="tipAngleWrap" visible={tipAngleVisible}>
        <Label htmlFor="tipAngleDeg">尖端角 <FieldValue id="tipAngleVal">{tipAngleDeg}°</FieldValue></Label>
        <RangeInput
          id="tipAngleDeg"
          min="15"
          max="60"
          value={tipAngleDeg}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setTipAngleDeg(value);
            preview("tipAngleDeg", value);
          }}
          onPointerUp={(event) => commit("tipAngleDeg", event.currentTarget.value)}
          onKeyUp={(event) => commit("tipAngleDeg", event.currentTarget.value)}
          onBlur={(event) => commit("tipAngleDeg", event.currentTarget.value)}
          onChange={(event) => setTipAngleDeg(event.currentTarget.value)}
        />
      </FieldGroup>
      <FieldGroup>
        <Label htmlFor="shiftAlongMm">沿长轴移动 mm <FieldValue id="shiftAlongVal">{shiftAlongMm}</FieldValue></Label>
        <RangeInput
          id="shiftAlongMm"
          min="-12"
          max="12"
          value={shiftAlongMm}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setShiftAlongMm(value);
            preview("shiftAlongMm", value);
          }}
          onPointerUp={(event) => commit("shiftAlongMm", event.currentTarget.value)}
          onKeyUp={(event) => commit("shiftAlongMm", event.currentTarget.value)}
          onBlur={(event) => commit("shiftAlongMm", event.currentTarget.value)}
          onChange={(event) => setShiftAlongMm(event.currentTarget.value)}
        />
      </FieldGroup>
      <FieldGroup>
        <Label htmlFor="shiftPerpMm">垂直长轴移动 mm <FieldValue id="shiftPerpVal">{shiftPerpMm}</FieldValue></Label>
        <RangeInput
          id="shiftPerpMm"
          min="-12"
          max="12"
          value={shiftPerpMm}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setShiftPerpMm(value);
            preview("shiftPerpMm", value);
          }}
          onPointerUp={(event) => commit("shiftPerpMm", event.currentTarget.value)}
          onKeyUp={(event) => commit("shiftPerpMm", event.currentTarget.value)}
          onBlur={(event) => commit("shiftPerpMm", event.currentTarget.value)}
          onChange={(event) => setShiftPerpMm(event.currentTarget.value)}
        />
      </FieldGroup>
      <Select
        id="editReason"
        value={reason}
        onChange={(event) => {
          const value = event.currentTarget.value;
          setReason(value);
          commands.edit("commit_reason", "editReason", value);
        }}
      >
        <option value="">未选择覆盖原因</option>
        <option value="manual scar camouflage">瘢痕隐蔽优先</option>
        <option value="manual free-margin protection">游离缘保护优先</option>
        <option value="manual subunit boundary alignment">贴合美学亚单位边界</option>
        <option value="manual clinician preference">医生人工判断</option>
      </Select>
      <ButtonRow className="two-cols">
        <Button variant="workbench" id="undoEditBtn" type="button" disabled={undoDisabled} onClick={() => commands.edit("undo_edit")}>撤销调整</Button>
        <Button variant="workbench" id="redoEditBtn" type="button" disabled={redoDisabled} onClick={() => commands.edit("redo_edit")}>重做调整</Button>
      </ButtonRow>
      <Button variant="workbench" id="resetEditBtn" type="button" onClick={() => commands.edit("reset_edit")}>恢复工具建议</Button>
      <WorkbenchNote id="editHistoryState">{historyLabel}</WorkbenchNote>
      <WorkbenchNote>调整只改变候选草案并记录 provenance；真实切口仍需医生复核。</WorkbenchNote>
    </WorkbenchCard>
  );
}
