import { useEffect, useState } from "react";

import { dispatchIncisionTumorCommand } from "../lib/controllerCommand";
import { useIncisionStore } from "../stores/incisionStore";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select } from "./ui/select";
import { RangeInput } from "./ui/slider";

function hiddenClass(hidden: boolean) {
  return hidden ? "hidden" : "";
}

export function TumorInputPanel() {
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
    <div className="card agent-grid">
      <Label htmlFor="tumorKind">肿物类型</Label>
      <Select
        id="tumorKind"
        value={kind}
        onChange={(event) => {
          setKind(event.currentTarget.value);
          setBoundaryActive(false);
          dispatchIncisionTumorCommand("kind_changed");
        }}
      >
        <option value="subcutaneous">皮下肿物 · 线性切口</option>
        <option value="cutaneous">皮表肿物 · 梭形切口</option>
      </Select>
      <div>
        <Label htmlFor="diameterMm">直径 mm <span id="diameterVal" className="val">{diameter}</span></Label>
        <RangeInput
          id="diameterMm"
          min="4"
          max="40"
          value={diameter}
          onInput={(event) => {
            setDiameter(event.currentTarget.value);
            dispatchIncisionTumorCommand("diameter_input");
          }}
          onPointerUp={() => dispatchIncisionTumorCommand("diameter_changed")}
          onKeyUp={() => dispatchIncisionTumorCommand("diameter_changed")}
          onBlur={() => dispatchIncisionTumorCommand("diameter_changed")}
          onChange={(event) => setDiameter(event.currentTarget.value)}
        />
      </div>
      <div>
        <Label htmlFor="tumorAuthor">记录者</Label>
        <Input
          id="tumorAuthor"
          value={author}
          onChange={(event) => {
            setAuthor(event.currentTarget.value);
            dispatchIncisionTumorCommand("author_changed");
          }}
        />
      </div>
      <div id="depthWrap" className={hiddenClass(cutaneous)}>
        <Label htmlFor="depthMm">深度 mm <span id="depthVal" className="val">{depth}</span></Label>
        <RangeInput
          id="depthMm"
          min="0"
          max="35"
          value={depth}
          onInput={(event) => {
            setDepth(event.currentTarget.value);
            dispatchIncisionTumorCommand("depth_input");
          }}
          onPointerUp={() => dispatchIncisionTumorCommand("depth_changed")}
          onKeyUp={() => dispatchIncisionTumorCommand("depth_changed")}
          onBlur={() => dispatchIncisionTumorCommand("depth_changed")}
          onChange={(event) => setDepth(event.currentTarget.value)}
        />
      </div>
      <div id="marginWrap" className={hiddenClass(!cutaneous)}>
        <Label htmlFor="marginMm">安全切缘 mm <span id="marginVal" className="val">{margin}</span></Label>
        <RangeInput
          id="marginMm"
          min="0"
          max="10"
          value={margin}
          onInput={(event) => {
            setMargin(event.currentTarget.value);
            dispatchIncisionTumorCommand("margin_input");
          }}
          onPointerUp={() => dispatchIncisionTumorCommand("margin_changed")}
          onKeyUp={() => dispatchIncisionTumorCommand("margin_changed")}
          onBlur={() => dispatchIncisionTumorCommand("margin_changed")}
          onChange={(event) => setMargin(event.currentTarget.value)}
        />
      </div>
      <div id="boundaryWrap" className={hiddenClass(!cutaneous)}>
        <Label htmlFor="boundaryMode">皮表边界</Label>
        <Select
          id="boundaryMode"
          value={boundaryMode}
          onChange={(event) => {
            setBoundaryMode(event.currentTarget.value);
            setBoundaryActive(false);
            dispatchIncisionTumorCommand("boundary_mode_changed");
          }}
        >
          <option value="ellipse">椭圆近似</option>
          <option value="freehand">自由轮廓点</option>
        </Select>
      </div>
      <div id="ellipseWrap" className={hiddenClass(!cutaneous || boundaryMode !== "ellipse")}>
        <Label htmlFor="ellipseRatio">椭圆短轴比例 <span id="ellipseRatioVal" className="val">{ellipseRatio}%</span></Label>
        <RangeInput
          id="ellipseRatio"
          min="40"
          max="100"
          value={ellipseRatio}
          onInput={(event) => {
            setEllipseRatio(event.currentTarget.value);
            dispatchIncisionTumorCommand("ellipse_ratio_input");
          }}
          onPointerUp={() => dispatchIncisionTumorCommand("ellipse_ratio_changed")}
          onKeyUp={() => dispatchIncisionTumorCommand("ellipse_ratio_changed")}
          onBlur={() => dispatchIncisionTumorCommand("ellipse_ratio_changed")}
          onChange={(event) => setEllipseRatio(event.currentTarget.value)}
        />
      </div>
      <div className={`btn-row two-cols ${freehand ? "" : "hidden"}`} id="freehandControls">
        <Button
          variant="workbench"
          id="startBoundaryBtn"
          type="button"
          onClick={() => {
            setBoundaryActive((value) => !value);
            dispatchIncisionTumorCommand("toggle_boundary");
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
            dispatchIncisionTumorCommand("clear_boundary");
          }}
        >
          清空轮廓
        </Button>
      </div>
      <p className={`boundary-status${boundaryStatusWarn ? " warn" : ""}`} id="boundaryStatus">{boundaryStatus}</p>
      <div className="btn-row two-cols">
        <Button variant="workbench" id="exportTumorBtn" type="button" onClick={() => dispatchIncisionTumorCommand("export_tumor")}>导出肿物</Button>
        <Button variant="workbench" id="importTumorBtn" type="button" onClick={() => dispatchIncisionTumorCommand("import_tumor")}>导入肿物</Button>
      </div>
      <Input id="tumorImportFile" className="hidden" type="file" accept="application/json,.json" />
      <Button variant="workbenchPrimary" id="runAgentBtn" type="button" onClick={() => dispatchIncisionTumorCommand("run_agent")}>生成候选切口</Button>
      <p className="agent-note" id="pickState">{freehand ? boundaryHint : pickState}</p>
      <p className={`anatomy-preview${anatomyPreviewWarn ? " warn" : ""}`} id="anatomyPreview">{anatomyPreview}</p>
    </div>
  );
}
