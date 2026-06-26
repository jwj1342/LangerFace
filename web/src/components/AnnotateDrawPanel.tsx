import { useAnnotateStore } from "../stores/annotateStore";

const ANNOTATE_DRAW_REACT_COMMAND_EVENT = "langerface:annotate-draw-react-command";

function dispatchDrawCommand(command: string, value?: string) {
  window.dispatchEvent(new CustomEvent(ANNOTATE_DRAW_REACT_COMMAND_EVENT, { detail: { command, value } }));
}

function currentStateText(snapshot: ReturnType<typeof useAnnotateStore.getState>["snapshot"]) {
  const draft = snapshot?.draft;
  if (!draft?.active) return "当前没有正在绘制的线。点击“开始一条线”，或直接在脸表面点击开始。";
  const system = snapshot?.system?.toUpperCase?.() || "RSTL";
  const countText = draft.controlCount < 2 ? "（至少 2 点可保存）" : "";
  const fallback = draft.fallback ? " · 贴面路由已退回直线，需复核可能穿面" : "";
  return `正在绘制：${draft.name || "未命名"} · ${system} · ${draft.controlCount} 点${countText}${fallback}`;
}

export function AnnotateDrawPanel() {
  const snapshot = useAnnotateStore((state) => state.snapshot);
  const draft = snapshot?.draft;
  const savedCount = snapshot?.saved.count || 0;
  const active = Boolean(draft?.active);

  return (
    <div className="card">
      <div className="section-title">
        <span>1. 选择线系统</span>
        <span id="drawMode">{snapshot?.mesh.modeLabel || "FLAME 标准脸"}</span>
      </div>
      <div>
        <label className="field-label" htmlFor="annSystem">线系统</label>
        <select
          id="annSystem"
          className="select annotate-system-select"
          defaultValue={snapshot?.system || "rstl"}
          onChange={(event) => dispatchDrawCommand("system_changed", event.currentTarget.value)}
        >
          <option value="rstl">RSTL（首选）</option>
          <option value="langer">Langer</option>
        </select>
      </div>
      <div className="section-title">
        <span>2. 填写当前线</span>
        <span>可留空</span>
      </div>
      <input className="text-input" id="annName" placeholder="线名，例如 forehead_h1" />
      <input className="text-input" id="annRegion" placeholder="区域，例如 forehead / cheek / perioral" />
      <div className={`current-state${active ? " active" : ""}${draft?.fallback ? " warning" : ""}`} id="currentState">{currentStateText(snapshot)}</div>
      <div className="btn-row annotate-actions">
        <button className="btn btn-primary" id="btnNew" type="button" disabled={active} onClick={() => dispatchDrawCommand("start_line")}>开始一条线</button>
        <button className="btn" id="btnUndo" type="button" disabled={!active && !savedCount} onClick={() => dispatchDrawCommand("undo_last")}>撤销上一个点</button>
        <button className="btn" id="btnFinish" type="button" disabled={!active} onClick={() => dispatchDrawCommand("save_current_line")}>保存当前线</button>
      </div>
    </div>
  );
}
