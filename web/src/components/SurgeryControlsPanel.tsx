import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { RangeInput } from "./ui/slider";

interface SurgeryControlsPanelProps {
  activeCut: "along" | null;
  hint: string;
  isReady: boolean;
  lesionState: string;
  showLines: boolean;
  sizePct: number;
  onExciseAlong: () => void;
  onReset: () => void;
  onShowLinesChange: (checked: boolean) => void;
  onSizeChange: (value: number) => void;
}

export function SurgeryControlsPanel({
  activeCut,
  hint,
  isReady,
  lesionState,
  showLines,
  sizePct,
  onExciseAlong,
  onReset,
  onShowLinesChange,
  onSizeChange,
}: SurgeryControlsPanelProps) {
  return (
    <div className="card">
      <p className="hint" id="hint">{hint}</p>
      <div className="section-title"><span>① 规划切口</span><span id="lesionState">{lesionState}</span></div>
      <p className="hint">
        在右侧脸上<b>点击</b>定位病灶；拖拽旋转、滚轮缩放。
        右图 <b className="surgery-green-copy">绿色</b>=沿 RSTL 的梭形切除轮廓，随下方滑块更新。
      </p>
      <Label htmlFor="sizeRange">切口大小 <span id="sizeVal">{sizePct}%</span></Label>
      <RangeInput
        id="sizeRange"
        min="80"
        max="200"
        value={sizePct}
        onChange={(event) => onSizeChange(Number(event.currentTarget.value))}
      />
      <div className="section-title"><span>② 执行切除并闭合</span></div>
      <div className="btn-row surgery-action-row">
        <Button
          variant="workbench"
          className={`cut-along${activeCut === "along" ? " active" : ""}`}
          id="btnAlong"
          type="button"
          disabled={!isReady}
          onClick={onExciseAlong}
        >
          沿 RSTL 切除
        </Button>
      </div>
      <Button variant="workbench" id="btnReset" type="button" disabled={!isReady} onClick={onReset}>↺ 复位</Button>
      <Button asChild variant="workbench">
        <label>
          <Checkbox
            id="showLines"
            checked={showLines}
            onChange={(event) => onShowLinesChange(event.currentTarget.checked)}
          /> 显示 RSTL 张力线
        </label>
      </Button>
    </div>
  );
}
