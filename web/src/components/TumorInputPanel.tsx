import { useEffect, useState } from "react";

import { dispatchControllerCommand } from "../lib/controllerCommand";
import { useIncisionStore } from "../stores/incisionStore";

const TUMOR_REACT_COMMAND_EVENT = "langerface:incision-tumor-react-command";

function dispatchTumorCommand(command: string) {
  dispatchControllerCommand(TUMOR_REACT_COMMAND_EVENT, { command });
}

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
      <label className="field-label" htmlFor="tumorKind">肿物类型</label>
      <select
        id="tumorKind"
        className="select"
        value={kind}
        onChange={(event) => {
          setKind(event.currentTarget.value);
          setBoundaryActive(false);
          dispatchTumorCommand("kind_changed");
        }}
      >
        <option value="subcutaneous">皮下肿物 · 线性切口</option>
        <option value="cutaneous">皮表肿物 · 梭形切口</option>
      </select>
      <div>
        <label className="field-label" htmlFor="diameterMm">直径 mm <span id="diameterVal" className="val">{diameter}</span></label>
        <input
          id="diameterMm"
          type="range"
          min="4"
          max="40"
          value={diameter}
          onInput={(event) => {
            setDiameter(event.currentTarget.value);
            dispatchTumorCommand("diameter_input");
          }}
          onPointerUp={() => dispatchTumorCommand("diameter_changed")}
          onKeyUp={() => dispatchTumorCommand("diameter_changed")}
          onBlur={() => dispatchTumorCommand("diameter_changed")}
          onChange={(event) => setDiameter(event.currentTarget.value)}
        />
      </div>
      <div>
        <label className="field-label" htmlFor="tumorAuthor">记录者</label>
        <input
          id="tumorAuthor"
          className="text-input"
          value={author}
          onChange={(event) => {
            setAuthor(event.currentTarget.value);
            dispatchTumorCommand("author_changed");
          }}
        />
      </div>
      <div id="depthWrap" className={hiddenClass(cutaneous)}>
        <label className="field-label" htmlFor="depthMm">深度 mm <span id="depthVal" className="val">{depth}</span></label>
        <input
          id="depthMm"
          type="range"
          min="0"
          max="35"
          value={depth}
          onInput={(event) => {
            setDepth(event.currentTarget.value);
            dispatchTumorCommand("depth_input");
          }}
          onPointerUp={() => dispatchTumorCommand("depth_changed")}
          onKeyUp={() => dispatchTumorCommand("depth_changed")}
          onBlur={() => dispatchTumorCommand("depth_changed")}
          onChange={(event) => setDepth(event.currentTarget.value)}
        />
      </div>
      <div id="marginWrap" className={hiddenClass(!cutaneous)}>
        <label className="field-label" htmlFor="marginMm">安全切缘 mm <span id="marginVal" className="val">{margin}</span></label>
        <input
          id="marginMm"
          type="range"
          min="0"
          max="10"
          value={margin}
          onInput={(event) => {
            setMargin(event.currentTarget.value);
            dispatchTumorCommand("margin_input");
          }}
          onPointerUp={() => dispatchTumorCommand("margin_changed")}
          onKeyUp={() => dispatchTumorCommand("margin_changed")}
          onBlur={() => dispatchTumorCommand("margin_changed")}
          onChange={(event) => setMargin(event.currentTarget.value)}
        />
      </div>
      <div id="boundaryWrap" className={hiddenClass(!cutaneous)}>
        <label className="field-label" htmlFor="boundaryMode">皮表边界</label>
        <select
          id="boundaryMode"
          className="select"
          value={boundaryMode}
          onChange={(event) => {
            setBoundaryMode(event.currentTarget.value);
            setBoundaryActive(false);
            dispatchTumorCommand("boundary_mode_changed");
          }}
        >
          <option value="ellipse">椭圆近似</option>
          <option value="freehand">自由轮廓点</option>
        </select>
      </div>
      <div id="ellipseWrap" className={hiddenClass(!cutaneous || boundaryMode !== "ellipse")}>
        <label className="field-label" htmlFor="ellipseRatio">椭圆短轴比例 <span id="ellipseRatioVal" className="val">{ellipseRatio}%</span></label>
        <input
          id="ellipseRatio"
          type="range"
          min="40"
          max="100"
          value={ellipseRatio}
          onInput={(event) => {
            setEllipseRatio(event.currentTarget.value);
            dispatchTumorCommand("ellipse_ratio_input");
          }}
          onPointerUp={() => dispatchTumorCommand("ellipse_ratio_changed")}
          onKeyUp={() => dispatchTumorCommand("ellipse_ratio_changed")}
          onBlur={() => dispatchTumorCommand("ellipse_ratio_changed")}
          onChange={(event) => setEllipseRatio(event.currentTarget.value)}
        />
      </div>
      <div className={`btn-row two-cols ${freehand ? "" : "hidden"}`} id="freehandControls">
        <button
          className="btn"
          id="startBoundaryBtn"
          type="button"
          onClick={() => {
            setBoundaryActive((value) => !value);
            dispatchTumorCommand("toggle_boundary");
          }}
        >
          {boundaryButtonLabel}
        </button>
        <button
          className="btn"
          id="clearBoundaryBtn"
          type="button"
          onClick={() => {
            setBoundaryActive(false);
            setBoundaryPointCount(0);
            dispatchTumorCommand("clear_boundary");
          }}
        >
          清空轮廓
        </button>
      </div>
      <p className={`boundary-status${boundaryStatusWarn ? " warn" : ""}`} id="boundaryStatus">{boundaryStatus}</p>
      <div className="btn-row two-cols">
        <button className="btn" id="exportTumorBtn" type="button" onClick={() => dispatchTumorCommand("export_tumor")}>导出肿物</button>
        <button className="btn" id="importTumorBtn" type="button" onClick={() => dispatchTumorCommand("import_tumor")}>导入肿物</button>
      </div>
      <input id="tumorImportFile" className="hidden" type="file" accept="application/json,.json" />
      <button className="btn btn-primary" id="runAgentBtn" type="button" onClick={() => dispatchTumorCommand("run_agent")}>生成候选切口</button>
      <p className="agent-note" id="pickState">{freehand ? boundaryHint : pickState}</p>
      <p className={`anatomy-preview${anatomyPreviewWarn ? " warn" : ""}`} id="anatomyPreview">{anatomyPreview}</p>
    </div>
  );
}
