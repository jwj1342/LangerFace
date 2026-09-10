import { useEffect, useState } from "react";
import { MARKER_DIAGNOSTIC_EVENT } from "../services/controlledMarkerRunDiagnostics";
import { dispatchMarkerDiagnosticCommand } from "../lib/controllerCommand";

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
  const [diagnosticEnabled] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("markerDiagnostics") === "1");
  const [diagnosticMessage, setDiagnosticMessage] = useState("仅本地取证；请重新上传原图后识别，客户端源码身份仍待确认。");
  useEffect(() => {
    if (!diagnosticEnabled) return;
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      if (typeof detail?.message === "string") setDiagnosticMessage(detail.message);
    };
    window.addEventListener(MARKER_DIAGNOSTIC_EVENT, listener);
    return () => window.removeEventListener(MARKER_DIAGNOSTIC_EVENT, listener);
  }, [diagnosticEnabled]);
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
  const ellipseRatioDisabled = Boolean(snapshot?.workflowTools?.controlledMarkerMode);
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
      <FieldGroup
        id="ellipseWrap"
        visible={cutaneous && boundaryMode === "ellipse"}
        className={ellipseRatioDisabled ? "ellipse-ratio-field-disabled" : undefined}
        aria-disabled={ellipseRatioDisabled}
      >
        <Label htmlFor="ellipseRatio">轮廓纵/横比例 <FieldValue id="ellipseRatioVal">{ellipseRatio}%</FieldValue></Label>
        <RangeInput
          id="ellipseRatio"
          min="40"
          max="200"
          disabled={ellipseRatioDisabled}
          aria-label={ellipseRatioDisabled
            ? "轮廓纵横比例；受控标记使用已识别的真实边界，暂不可调整"
            : "轮廓纵横比例；调整形状并保持模拟轮廓面积不变"}
          title={ellipseRatioDisabled
            ? "受控标记使用已识别的真实肿物边界，不使用模拟类圆的纵横比例。"
            : "只改变模拟类圆的纵横形状；直径按等面积圆计算，轮廓面积保持不变。"}
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
      {diagnosticEnabled ? <section aria-label="图13本地诊断" id="markerDiagnosticPanel">
        <WorkbenchNote>诊断取证，不改变识别算法；不是临床验收。</WorkbenchNote>
        <ButtonRow className="two-cols">
          <Button variant="workbench" id="exportMarkerDiagnosticBtn" type="button" onClick={() => dispatchMarkerDiagnosticCommand("export_marker_diagnostic")}>导出本次诊断</Button>
          <Button variant="workbench" id="replayMarkerDiagnosticBtn" type="button" onClick={() => dispatchMarkerDiagnosticCommand("replay_marker_diagnostic")}>核对并复放</Button>
        </ButtonRow>
        <Label htmlFor="markerDiagnosticImport">导入另一端诊断（JSON，不导入图片）</Label>
        <Input id="markerDiagnosticImport" type="file" accept="application/json,.json" onChange={async (event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          if (file.size > 2_000_000) { setDiagnosticMessage("诊断文件超过2MB"); return; }
          try { dispatchMarkerDiagnosticCommand("import_marker_diagnostic", await file.text()); }
          catch { setDiagnosticMessage("诊断文件读取失败"); }
        }} />
        <WorkbenchNote id="markerDiagnosticStatus" role="status">{diagnosticMessage}</WorkbenchNote>
      </section> : null}
      <Button className="workflow-recalculate-action" variant="workbenchPrimary" id="runWorkflowBtn" type="button" onClick={() => commands.tumor("run_workflow")}>重新计算候选</Button>
      <WorkbenchNote id="pickState">{freehand ? boundaryHint : pickState}</WorkbenchNote>
      <AnatomyPreview warn={anatomyPreviewWarn} id="anatomyPreview">{anatomyPreview}</AnatomyPreview>
    </WorkbenchCard>
  );
}
