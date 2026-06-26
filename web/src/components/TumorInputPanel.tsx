import { useEffect, useState } from "react";

import { useIncisionControllerCommands } from "../hooks/useControllerCommands";
import { useIncisionStore } from "../stores/incisionStore";
import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { AgentCard } from "./ui/card";
import { FieldGroup } from "./ui/field-group";
import { AgentNote } from "./ui/hint";
import { AnatomyPreview, BoundaryStatus } from "./ui/incision-feedback";
import { Input } from "./ui/input";
import { FieldValue, Label } from "./ui/label";
import { Select } from "./ui/select";
import { RangeInput } from "./ui/slider";

export function TumorInputPanel() {
  const commands = useIncisionControllerCommands();
  const snapshot = useIncisionStore((state) => state.snapshot);
  const [kind, setKind] = useState("subcutaneous");
  const [diameter, setDiameter] = useState("12");
  const [author, setAuthor] = useState("clinician");
  const [depth, setDepth] = useState("6");
  const [margin, setMargin] = useState("2");
  const [boundaryMode, setBoundaryMode] = useState("ellipse");
  const [ellipseRatio, setEllipseRatio] = useState("70");
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
    setKind(tumor.kind || "subcutaneous");
    if (tumor.author) setAuthor(tumor.author);
    if (tumor.diameterMm != null) setDiameter(String(tumor.diameterMm));
    if (tumor.kind === "subcutaneous" && tumor.depthMm != null) setDepth(String(tumor.depthMm));
    if (tumor.kind === "cutaneous" && tumor.marginMm != null) setMargin(String(tumor.marginMm));
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
  const boundaryButtonLabel = boundaryActive ? "结束轮廓" : "开始轮廓";
  const boundaryHint = boundaryPointCount > 0
    ? `自由轮廓点：${boundaryPointCount} 个`
    : boundaryActive
      ? "请在脸上连续点击皮表肿物边界点。"
      : pickState;

  return (
    <AgentCard>
      <Label htmlFor="tumorKind">肿物类型</Label>
      <Select
        id="tumorKind"
        value={kind}
        onChange={(event) => {
          setKind(event.currentTarget.value);
          setBoundaryActive(false);
          commands.tumor("kind_changed");
        }}
      >
        <option value="subcutaneous">皮下肿物 · 线性切口</option>
        <option value="cutaneous">皮表肿物 · 梭形切口</option>
      </Select>
      <FieldGroup>
        <Label htmlFor="diameterMm">直径 mm <FieldValue id="diameterVal">{diameter}</FieldValue></Label>
        <RangeInput
          id="diameterMm"
          min="4"
          max="40"
          value={diameter}
          onInput={(event) => {
            setDiameter(event.currentTarget.value);
            commands.tumor("diameter_input");
          }}
          onPointerUp={() => commands.tumor("diameter_changed")}
          onKeyUp={() => commands.tumor("diameter_changed")}
          onBlur={() => commands.tumor("diameter_changed")}
          onChange={(event) => setDiameter(event.currentTarget.value)}
        />
      </FieldGroup>
      <FieldGroup>
        <Label htmlFor="tumorAuthor">记录者</Label>
        <Input
          id="tumorAuthor"
          value={author}
          onChange={(event) => {
            setAuthor(event.currentTarget.value);
            commands.tumor("author_changed");
          }}
        />
      </FieldGroup>
      <FieldGroup id="depthWrap" visible={!cutaneous}>
        <Label htmlFor="depthMm">深度 mm <FieldValue id="depthVal">{depth}</FieldValue></Label>
        <RangeInput
          id="depthMm"
          min="0"
          max="35"
          value={depth}
          onInput={(event) => {
            setDepth(event.currentTarget.value);
            commands.tumor("depth_input");
          }}
          onPointerUp={() => commands.tumor("depth_changed")}
          onKeyUp={() => commands.tumor("depth_changed")}
          onBlur={() => commands.tumor("depth_changed")}
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
            setMargin(event.currentTarget.value);
            commands.tumor("margin_input");
          }}
          onPointerUp={() => commands.tumor("margin_changed")}
          onKeyUp={() => commands.tumor("margin_changed")}
          onBlur={() => commands.tumor("margin_changed")}
          onChange={(event) => setMargin(event.currentTarget.value)}
        />
      </FieldGroup>
      <FieldGroup id="boundaryWrap" visible={cutaneous}>
        <Label htmlFor="boundaryMode">皮表边界</Label>
        <Select
          id="boundaryMode"
          value={boundaryMode}
          onChange={(event) => {
            setBoundaryMode(event.currentTarget.value);
            setBoundaryActive(false);
            commands.tumor("boundary_mode_changed");
          }}
        >
          <option value="ellipse">椭圆近似</option>
          <option value="freehand">自由轮廓点</option>
        </Select>
      </FieldGroup>
      <FieldGroup id="ellipseWrap" visible={cutaneous && boundaryMode === "ellipse"}>
        <Label htmlFor="ellipseRatio">椭圆短轴比例 <FieldValue id="ellipseRatioVal">{ellipseRatio}%</FieldValue></Label>
        <RangeInput
          id="ellipseRatio"
          min="40"
          max="100"
          value={ellipseRatio}
          onInput={(event) => {
            setEllipseRatio(event.currentTarget.value);
            commands.tumor("ellipse_ratio_input");
          }}
          onPointerUp={() => commands.tumor("ellipse_ratio_changed")}
          onKeyUp={() => commands.tumor("ellipse_ratio_changed")}
          onBlur={() => commands.tumor("ellipse_ratio_changed")}
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
            setBoundaryActive(false);
            setBoundaryPointCount(0);
            commands.tumor("clear_boundary");
          }}
        >
          清空轮廓
        </Button>
      </ButtonRow>
      <BoundaryStatus warn={boundaryStatusWarn} id="boundaryStatus">{boundaryStatus}</BoundaryStatus>
      <ButtonRow className="two-cols">
        <Button variant="workbench" id="exportTumorBtn" type="button" onClick={() => commands.tumor("export_tumor")}>导出肿物</Button>
        <Button variant="workbench" id="importTumorBtn" type="button" onClick={() => commands.tumor("import_tumor")}>导入肿物</Button>
      </ButtonRow>
      <Input id="tumorImportFile" hidden type="file" accept="application/json,.json" />
      <Button variant="workbenchPrimary" id="runAgentBtn" type="button" onClick={() => commands.tumor("run_agent")}>生成候选切口</Button>
      <AgentNote id="pickState">{freehand ? boundaryHint : pickState}</AgentNote>
      <AnatomyPreview warn={anatomyPreviewWarn} id="anatomyPreview">{anatomyPreview}</AnatomyPreview>
    </AgentCard>
  );
}
