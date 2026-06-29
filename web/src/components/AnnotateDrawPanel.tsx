import { useAnnotateControllerCommands } from "../hooks/useControllerCommands";
import { useAnnotateStore } from "../stores/annotateStore";
import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { CurrentLineStatus } from "./ui/annotate-status";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { SectionTitle } from "./ui/section-title";
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
  const commands = useAnnotateControllerCommands();
  const snapshot = useAnnotateStore((state) => state.snapshot);
  const draft = snapshot?.draft;
  const savedCount = snapshot?.saved.count || 0;
  const active = Boolean(draft?.active);

  return (
    <Card>
      <SectionTitle label="1. 选择线系统" value={snapshot?.mesh.modeLabel || "标准三维面部模型"} valueProps={{ id: "drawMode" }} />
      <div>
        <Label htmlFor="annSystem">线系统</Label>
        <Select
          id="annSystem"
          className="annotate-system-select"
          defaultValue={snapshot?.system || "rstl"}
          onChange={(event) => commands.draw("system_changed", event.currentTarget.value)}
        >
          <option value="rstl">RSTL（首选）</option>
          <option value="langer">Langer</option>
        </Select>
      </div>
      <SectionTitle label="2. 填写当前线" value="可留空" />
      <Input id="annName" placeholder="线名，例如 forehead_h1" />
      <Input id="annRegion" placeholder="区域，例如 forehead / cheek / perioral" />
      <CurrentLineStatus active={active} warn={Boolean(draft?.fallback)} id="currentState">
        {currentStateText(snapshot)}
      </CurrentLineStatus>
      <ButtonRow className="annotate-actions">
        <Button variant="workbenchPrimary" id="btnNew" type="button" disabled={active} onClick={() => commands.draw("start_line")}>开始一条线</Button>
        <Button variant="workbench" id="btnUndo" type="button" disabled={!active && !savedCount} onClick={() => commands.draw("undo_last")}>撤销上一个点</Button>
        <Button variant="workbench" id="btnFinish" type="button" disabled={!active} onClick={() => commands.draw("save_current_line")}>保存当前线</Button>
      </ButtonRow>
    </Card>
  );
}
