import { useEffect, useState } from "react";

import { useIncisionControllerCommands } from "../hooks/useControllerCommands";
import { useIncisionStore } from "../stores/incisionStore";
import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { WorkbenchCard } from "./ui/card";
import { FieldGroup } from "./ui/field-group";
import { WorkbenchNote } from "./ui/hint";
import { AnatomyPreview, BoundaryStatus } from "./ui/incision-feedback";
import { Input } from "./ui/input";
import { FieldValue, Label } from "./ui/label";
import { Select } from "./ui/select";
import { RangeInput } from "./ui/slider";
import { PersistentTooltip, usePersistentTooltip } from "./ui/persistent-tooltip";
import { TUMOR_DIAMETER_DISABLED_MESSAGE } from "../services/incisionClinicalCopy";
import { tumorDiameterParameterInactive } from "../services/tumorInput";

export interface TumorInputPanelProps {
  showDepthControl?: boolean;
  continuousFreehand?: boolean;
}

export function TumorInputPanel({
  showDepthControl = true,
  continuousFreehand = false,
}: TumorInputPanelProps) {
  const commands = useIncisionControllerCommands();
  const snapshot = useIncisionStore((state) => state.snapshot);
  const [kind, setKind] = useState("cutaneous");
  const [diameter, setDiameter] = useState("8");
  const [author, setAuthor] = useState("clinician");
  const [depth, setDepth] = useState("6");
  const [margin, setMargin] = useState("0");
  const [boundaryMode, setBoundaryMode] = useState("ellipse");
  const [ellipseRatio, setEllipseRatio] = useState("100");
  const [boundaryActive, setBoundaryActive] = useState(false);
  const [boundaryPointCount, setBoundaryPointCount] = useState(0);
  const [boundaryStatus, setBoundaryStatus] = useState("皮表边界：中心直径");
  const [boundaryStatusWarn, setBoundaryStatusWarn] = useState(false);
  const [pickState, setPickState] = useState("当前点位：默认右颊。右侧标准脸可点击重选。");
  const [anatomyPreview, setAnatomyPreview] = useState("当前点位分区：待加载");
  const [anatomyPreviewWarn, setAnatomyPreviewWarn] = useState(false);

  useEffect(() => {
    const tumor = snapshot?.tumor;
    if (!tumor) return;
    setKind(tumor.kind || "cutaneous");
    if (tumor.author) setAuthor(tumor.author);
    if (tumor.diameterMm != null) setDiameter(String(tumor.diameterMm));
    if (tumor.kind === "subcutaneous" && tumor.depthMm != null) setDepth(String(tumor.depthMm));
    if (tumor.kind === "cutaneous" && tumor.marginMm != null) setMargin(String(tumor.marginMm));
    if (tumor.kind === "cutaneous" && tumor.ellipseRatio != null) setEllipseRatio(String(tumor.ellipseRatio));
    if (tumor.kind === "cutaneous" && (tumor.boundaryMode === "ellipse" || tumor.boundaryMode === "freehand")) {
      setBoundaryMode(tumor.boundaryMode);
    }
    setBoundaryActive(Boolean(tumor.boundaryActive));
    setBoundaryPointCount(Number.isFinite(tumor.boundaryPointCount) ? tumor.boundaryPointCount : 0);
    setBoundaryStatus(tumor.boundaryStatus || "皮表边界：中心直径");
    setBoundaryStatusWarn(Boolean(tumor.boundaryStatusWarn));
    setPickState(tumor.pickState || "当前点位：默认右颊。右侧标准脸可点击重选。");
    setAnatomyPreview(tumor.anatomyPreview || "当前点位分区：待加载");
    setAnatomyPreviewWarn(Boolean(tumor.anatomyPreviewWarn));
  }, [snapshot?.tumor]);

  const cutaneous = kind === "cutaneous";
  const freehand = cutaneous && boundaryMode === "freehand";
  const diameterDisabled = tumorDiameterParameterInactive({
    kind,
    boundaryMode,
    controlledMarkerMode: Boolean(snapshot?.workflowTools?.controlledMarkerMode),
  });
  const diameterTooltip = usePersistentTooltip<HTMLButtonElement>(diameterDisabled);
  const boundaryButtonLabel = boundaryActive
    ? continuousFreehand ? "结束描绘" : "结束轮廓"
    : continuousFreehand ? "开始描绘" : "开始轮廓";
  const boundaryHint = boundaryPointCount > 0
    ? continuousFreehand
      ? `自由轮廓轨迹：${boundaryPointCount} 个采样点`
      : `自由轮廓点：${boundaryPointCount} 个`
    : boundaryActive
      ? continuousFreehand
        ? "请按住鼠标左键沿边界描画；完成后点击“结束描绘”识别。"
        : "请在脸上连续点击皮表肿物边界点。"
      : pickState;

  return (
    <WorkbenchCard>
      <Label htmlFor="tumorKind">肿物类型</Label>
      <Select
        id="tumorKind"
        value={kind}
        onChange={(event) => {
          const value = event.currentTarget.value;
          setKind(value);
          setBoundaryActive(false);
          commands.tumor("kind_changed", value);
        }}
      >
        <option value="cutaneous">皮表肿物 · 梭形切口</option>
        <option value="subcutaneous">皮下肿物 · 线性切口</option>
      </Select>
      <FieldGroup
        className={diameterDisabled ? "diameter-field-disabled" : undefined}
        aria-disabled={diameterDisabled}
      >
        <Label htmlFor="diameterMm">直径 mm <FieldValue id="diameterVal">{diameter}</FieldValue></Label>
        <RangeInput
          id="diameterMm"
          min="2"
          max="40"
          value={diameter}
          disabled={diameterDisabled}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setDiameter(value);
            commands.tumor("diameter_input", value);
          }}
          onPointerUp={(event) => commands.tumor("diameter_changed", event.currentTarget.value)}
          onKeyUp={(event) => commands.tumor("diameter_changed", event.currentTarget.value)}
          onBlur={(event) => commands.tumor("diameter_changed", event.currentTarget.value)}
          onChange={(event) => setDiameter(event.currentTarget.value)}
        />
        {diameterDisabled ? (
          <button
            ref={diameterTooltip.anchorRef}
            id="diameterDisabledHint"
            className="diameter-disabled-hint-target"
            type="button"
            aria-disabled="true"
            aria-label={TUMOR_DIAMETER_DISABLED_MESSAGE}
            aria-describedby="diameterDisabledTooltip"
            onPointerEnter={diameterTooltip.onPointerEnter}
            onPointerLeave={diameterTooltip.onPointerLeave}
            onPointerDown={diameterTooltip.onPointerDown}
            onPointerCancel={diameterTooltip.showForRelease}
            onFocus={diameterTooltip.onFocus}
            onBlur={diameterTooltip.onBlur}
            onClick={() => {
              diameterTooltip.showForRelease();
              commands.tumor("diameter_inactive_hint");
            }}
          />
        ) : null}
        <PersistentTooltip
          anchorRef={diameterTooltip.anchorRef}
          id="diameterDisabledTooltip"
          message={TUMOR_DIAMETER_DISABLED_MESSAGE}
          open={diameterTooltip.open}
        />
      </FieldGroup>
      <FieldGroup>
        <Label htmlFor="tumorAuthor">记录者</Label>
        <Input
          id="tumorAuthor"
          value={author}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setAuthor(value);
            commands.tumor("author_changed", value);
          }}
        />
      </FieldGroup>
      <FieldGroup id="depthWrap" visible={!cutaneous && showDepthControl}>
        <Label htmlFor="depthMm">深度 mm <FieldValue id="depthVal">{depth}</FieldValue></Label>
        <RangeInput
          id="depthMm"
          min="0"
          max="35"
          value={depth}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setDepth(value);
            commands.tumor("depth_input", value);
          }}
          onPointerUp={(event) => commands.tumor("depth_changed", event.currentTarget.value)}
          onKeyUp={(event) => commands.tumor("depth_changed", event.currentTarget.value)}
          onBlur={(event) => commands.tumor("depth_changed", event.currentTarget.value)}
          onChange={(event) => setDepth(event.currentTarget.value)}
        />
      </FieldGroup>
      <FieldGroup id="marginWrap" visible={cutaneous}>
        <Label htmlFor="marginMm">安全切缘 mm <FieldValue id="marginVal">{margin}</FieldValue></Label>
        <RangeInput
          id="marginMm"
          min="0"
          max="10"
          value={margin}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setMargin(value);
            commands.tumor("margin_input", value);
          }}
          onPointerUp={(event) => commands.tumor("margin_changed", event.currentTarget.value)}
          onKeyUp={(event) => commands.tumor("margin_changed", event.currentTarget.value)}
          onBlur={(event) => commands.tumor("margin_changed", event.currentTarget.value)}
          onChange={(event) => setMargin(event.currentTarget.value)}
        />
      </FieldGroup>
      <FieldGroup id="boundaryWrap" visible={cutaneous}>
        <Label htmlFor="boundaryMode">皮表边界</Label>
        <Select
          id="boundaryMode"
          value={boundaryMode}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setBoundaryMode(value);
            setBoundaryActive(continuousFreehand && value === "freehand");
            commands.tumor("boundary_mode_changed", value);
          }}
        >
          <option value="ellipse">椭圆近似</option>
          <option value="freehand">{continuousFreehand ? "自由轮廓鼠绘" : "自由轮廓点"}</option>
        </Select>
      </FieldGroup>
      <FieldGroup id="ellipseWrap" visible={cutaneous && boundaryMode === "ellipse"}>
        <Label htmlFor="ellipseRatio">轮廓纵/横比例 <FieldValue id="ellipseRatioVal">{ellipseRatio}%</FieldValue></Label>
        <RangeInput
          id="ellipseRatio"
          min="40"
          max="200"
          title="100% 为正圆；低于 100% 时纵向较短，高于 100% 时纵向较长。"
          value={ellipseRatio}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setEllipseRatio(value);
            commands.tumor("ellipse_ratio_input", value);
          }}
          onPointerUp={(event) => commands.tumor("ellipse_ratio_changed", event.currentTarget.value)}
          onKeyUp={(event) => commands.tumor("ellipse_ratio_changed", event.currentTarget.value)}
          onBlur={(event) => commands.tumor("ellipse_ratio_changed", event.currentTarget.value)}
          onChange={(event) => setEllipseRatio(event.currentTarget.value)}
        />
      </FieldGroup>
      <ButtonRow className="two-cols" id="freehandControls" visible={freehand}>
        <Button
          variant="workbench"
          id="startBoundaryBtn"
          type="button"
          onClick={() => {
            setBoundaryActive((value) => !value);
            commands.tumor("toggle_boundary");
          }}
        >
          {boundaryButtonLabel}
        </Button>
        <Button
          variant="workbench"
          id="clearBoundaryBtn"
          type="button"
          onClick={() => {
            setBoundaryActive(continuousFreehand && boundaryMode === "freehand");
            setBoundaryPointCount(0);
            commands.tumor("clear_boundary");
          }}
        >
          清空轮廓
        </Button>
      </ButtonRow>
      <BoundaryStatus warn={boundaryStatusWarn} id="boundaryStatus">{boundaryStatus}</BoundaryStatus>
      <ButtonRow className="two-cols workflow-tumor-transfer-actions">
        <Button variant="workbench" id="exportTumorBtn" type="button" onClick={() => commands.tumor("export_tumor")}>导出肿物</Button>
        <Button variant="workbench" id="importTumorBtn" type="button" onClick={() => commands.tumor("import_tumor")}>导入肿物</Button>
      </ButtonRow>
      <Input id="tumorImportFile" hidden type="file" accept="application/json,.json" />
      <Button className="workflow-recalculate-action" variant="workbenchPrimary" id="runWorkflowBtn" type="button" onClick={() => commands.tumor("run_workflow")}>重新计算候选</Button>
      <WorkbenchNote id="pickState">{freehand ? boundaryHint : pickState}</WorkbenchNote>
      <AnatomyPreview warn={anatomyPreviewWarn} id="anatomyPreview">{anatomyPreview}</AnatomyPreview>
    </WorkbenchCard>
  );
}
