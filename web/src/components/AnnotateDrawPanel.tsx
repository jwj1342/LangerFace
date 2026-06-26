import { dispatchAnnotateDrawCommand } from "../lib/controllerCommand";
import { useAnnotateStore } from "../stores/annotateStore";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select } from "./ui/select";

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
    <Card>
      <div className="section-title">
        <span>1. 选择线系统</span>
        <span id="drawMode">{snapshot?.mesh.modeLabel || "FLAME 标准脸"}</span>
      </div>
      <div>
        <Label htmlFor="annSystem">线系统</Label>
        <Select
          id="annSystem"
          className="annotate-system-select"
          defaultValue={snapshot?.system || "rstl"}
          onChange={(event) => dispatchAnnotateDrawCommand("system_changed", event.currentTarget.value)}
        >
          <option value="rstl">RSTL（首选）</option>
          <option value="langer">Langer</option>
        </Select>
      </div>
      <div className="section-title">
        <span>2. 填写当前线</span>
        <span>可留空</span>
      </div>
      <Input id="annName" placeholder="线名，例如 forehead_h1" />
      <Input id="annRegion" placeholder="区域，例如 forehead / cheek / perioral" />
      <div className={`current-state${active ? " active" : ""}${draft?.fallback ? " warning" : ""}`} id="currentState">{currentStateText(snapshot)}</div>
      <div className="btn-row annotate-actions">
        <Button variant="workbenchPrimary" id="btnNew" type="button" disabled={active} onClick={() => dispatchAnnotateDrawCommand("start_line")}>开始一条线</Button>
        <Button variant="workbench" id="btnUndo" type="button" disabled={!active && !savedCount} onClick={() => dispatchAnnotateDrawCommand("undo_last")}>撤销上一个点</Button>
        <Button variant="workbench" id="btnFinish" type="button" disabled={!active} onClick={() => dispatchAnnotateDrawCommand("save_current_line")}>保存当前线</Button>
      </div>
    </Card>
  );
}
