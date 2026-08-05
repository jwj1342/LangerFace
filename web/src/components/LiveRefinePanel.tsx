import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { Card } from "./ui/card";
import { CheckboxField } from "./ui/checkbox-field";
import { Hint } from "./ui/hint";
import { Label } from "./ui/label";

export function LiveRefinePanel() {
  return (
    <Card id="liveRefineCard">
      <Label>医生 2D 微调</Label>
      <Button variant="workbench" id="refine2dBtn" type="button" disabled aria-pressed="false">2D 结果微调</Button>
      <div className="live-refine-panel hidden" id="refine2dPanel">
        <div className="live-refine-status"><span>当前状态</span><span id="refine2dStatus">未开始</span></div>
        <ButtonRow className="live-refine-modes">
          <Button variant="workbench" id="refineViewBtn" type="button" aria-pressed="true">查看</Button>
          <Button variant="workbench" id="refineDragBtn" type="button">拖线</Button>
          <Button variant="workbench" id="refinePointBtn" type="button">拖点</Button>
          <Button variant="workbench" id="refineNormalBtn" type="button">法向</Button>
          <Button variant="workbench" id="refineEraseBtn" type="button">隐藏</Button>
        </ButtonRow>
        <ButtonRow>
          <Button variant="workbench" id="refineUndoBtn" type="button" disabled>撤销</Button>
          <Button variant="workbench" id="refineExportBtn" type="button" disabled>导出</Button>
        </ButtonRow>
        <label className="live-refine-range" htmlFor="refineSpread">
          <span>拖线联动范围</span><output id="refineSpreadVal">28%</output>
        </label>
        <input id="refineSpread" type="range" min="12" max="60" step="1" defaultValue="28" />
        <div className="live-refine-point-count hidden" id="refinePointCountWrap">
          <label className="live-refine-range" htmlFor="refinePointCount">
            <span>拖点数量</span><output id="refinePointCountVal">1 个点</output>
          </label>
          <input id="refinePointCount" type="range" min="1" max="30" step="1" defaultValue="1" />
          <Hint>以选中点为中心，连续控制指定数量的点；中心移动最多，两侧平滑递减。</Hint>
        </div>
        <div className="live-refine-nudge-head">
          <span>选中位置精调</span>
          <label>步长
            <select id="refineNudgeStep" aria-label="精调步长" defaultValue="0.5">
              <option value="0.25">0.25 px</option>
              <option value="0.5">0.5 px</option>
              <option value="1">1 px</option>
              <option value="2">2 px</option>
            </select>
          </label>
        </div>
        <ButtonRow className="live-refine-nudge" aria-label="选中位置精调">
          <Button variant="workbench" type="button" data-refine-nudge="left" aria-label="向左精调">←</Button>
          <Button variant="workbench" type="button" data-refine-nudge="up" aria-label="向上精调">↑</Button>
          <Button variant="workbench" type="button" data-refine-nudge="down" aria-label="向下精调">↓</Button>
          <Button variant="workbench" type="button" data-refine-nudge="right" aria-label="向右精调">→</Button>
        </ButtonRow>
        <CheckboxField checkboxProps={{ id: "refineSymmetryToggle", defaultChecked: true }}>对称联动</CheckboxField>
        <CheckboxField checkboxProps={{ id: "refineAxisToggle", defaultChecked: true }}>显示人脸中线</CheckboxField>
        <Button variant="workbench" id="refineResetBtn" type="button">恢复自动结果</Button>
        <Hint id="refine2dHint">“拖线”可向任意方向调整，“法向”只垂直于曲线移动；“拖点”可控制单点或一小段连续点。</Hint>
      </div>
    </Card>
  );
}
