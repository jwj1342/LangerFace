import { useEffect, useState } from "react";
import { MARKER_DIAGNOSTIC_EVENT } from "../services/controlledMarkerRunDiagnostics";
import { dispatchMarkerDiagnosticCommand } from "../lib/controllerCommand";

import { useIncisionControllerCommands } from "../hooks/useControllerCommands";
import { useIncisionStore } from "../stores/incisionStore";
import { useLiveStore } from "../stores/liveStore";
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

export interface TumorInputPanelProps {
  showDepthControl?: boolean;
  continuousFreehand?: boolean;
  simplifiedWorkflow?: boolean;
}

export function TumorInputPanel({
  showDepthControl = true,
  continuousFreehand = false,
  simplifiedWorkflow = false,
}: TumorInputPanelProps) {
  const commands = useIncisionControllerCommands();
  const [diagnosticEnabled] = useState(() => import.meta.env.DEV && typeof window !== "undefined"
    && (new URLSearchParams(window.location.search).get("developer") === "1"
      || new URLSearchParams(window.location.search).get("markerDiagnostics") === "1"));
  const [diagnosticMessage, setDiagnosticMessage] = useState("仅本地取证；请重新上传原图后识别，客户端源码身份仍待确认。");
  const [diagnosticDetailsOpen, setDiagnosticDetailsOpen] = useState(false);
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
  const cameraMode = useLiveStore((state) => state.snapshot?.source.kind === "camera");
  const [kind, setKind] = useState("cutaneous");
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
    if (tumor.kind === "subcutaneous" && tumor.depthMm != null) setDepth(String(tumor.depthMm));
    if (tumor.kind === "cutaneous" && tumor.marginMm != null) setMargin(String(tumor.marginMm));
    if (tumor.kind === "cutaneous" && tumor.ellipseRatio != null) setEllipseRatio(String(tumor.ellipseRatio));
    if (tumor.boundaryMode === "ellipse" || tumor.boundaryMode === "freehand") {
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
  const freehand = boundaryMode === "freehand";
  const ellipseRatioDisabled = Boolean(snapshot?.workflowTools?.controlledMarkerMode);
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
      <input id="diameterMm" type="hidden" min="2" max="40" value="8" readOnly aria-hidden="true" />
      <output id="diameterVal" hidden aria-hidden="true">8</output>
      <div className={cameraMode ? "workflow-disabled-field" : undefined}>
        <Label htmlFor="tumorKind">肿物类型</Label>
        <Select
          id="tumorKind"
          value={kind}
          disabled={cameraMode}
          title={cameraMode ? "摄像头模式下不可修改肿物类型" : undefined}
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
      </div>
      {!simplifiedWorkflow ? (
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
      ) : null}
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
      {!simplifiedWorkflow ? (
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
      ) : null}
      <FieldGroup id="boundaryWrap" className={cameraMode ? "workflow-disabled-field" : undefined}>
        <Label htmlFor="boundaryMode">肿物边界</Label>
        <Select
          id="boundaryMode"
          value={boundaryMode}
          disabled={cameraMode}
          title={cameraMode ? "摄像头模式下不可修改肿物边界" : undefined}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setBoundaryMode(value);
            setBoundaryActive(continuousFreehand && value === "freehand");
            commands.tumor("boundary_mode_changed", value);
          }}
        >
          <option value="ellipse">受控标记识别</option>
          <option value="freehand">{continuousFreehand ? "自由轮廓鼠绘" : "自由轮廓点"}</option>
        </Select>
      </FieldGroup>
      {!simplifiedWorkflow ? (
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
      ) : null}
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
      {!simplifiedWorkflow ? <BoundaryStatus warn={boundaryStatusWarn} id="boundaryStatus">{boundaryStatus}</BoundaryStatus> : null}
      {!simplifiedWorkflow ? <ButtonRow className="two-cols workflow-tumor-transfer-actions">
        <Button variant="workbench" id="exportTumorBtn" type="button" onClick={() => commands.tumor("export_tumor")}>导出肿物</Button>
        <Button variant="workbench" id="importTumorBtn" type="button" onClick={() => commands.tumor("import_tumor")}>导入肿物</Button>
      </ButtonRow> : null}
      <Input id="tumorImportFile" hidden type="file" accept="application/json,.json" />
      {diagnosticEnabled ? <section aria-label="受控标记开发者诊断" id="markerDiagnosticPanel">
        <div className="flex justify-end">
          <Button variant="workbench" className="text-xs" id="exportMarkerDiagnosticBtn" type="button" onClick={() => { setDiagnosticDetailsOpen(true); dispatchMarkerDiagnosticCommand("export_marker_diagnostic"); }}>导出诊断日志</Button>
        </div>
        <details open={diagnosticDetailsOpen} onToggle={(event) => setDiagnosticDetailsOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer text-xs">开发者诊断详情</summary>
        <WorkbenchNote>最近8次识别及处理原因；仅本页内存，刷新清空，不上传、不包含原图。生产构建关闭此入口。</WorkbenchNote>
        <ButtonRow className="two-cols">
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
        </details>
      </section> : null}
      <Button className="workflow-recalculate-action" variant="workbenchPrimary" id="runWorkflowBtn" type="button" disabled={cameraMode} title={cameraMode ? "摄像头模式下不可生成切口" : undefined} onClick={() => commands.tumor("run_workflow")}>重新计算候选</Button>
      {!simplifiedWorkflow ? <WorkbenchNote id="pickState">{freehand ? boundaryHint : pickState}</WorkbenchNote> : null}
      {!simplifiedWorkflow ? <AnatomyPreview warn={anatomyPreviewWarn} id="anatomyPreview">{anatomyPreview}</AnatomyPreview> : null}
    </WorkbenchCard>
  );
}
