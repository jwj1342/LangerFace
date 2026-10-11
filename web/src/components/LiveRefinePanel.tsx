import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { Card } from "./ui/card";
import { Hint } from "./ui/hint";
import { Label } from "./ui/label";

export function LiveRefinePanel() {
  return (
    <Card id="liveRefineCard">
      <Label>医生 2D 微调</Label>
      <Hint className="live-inline-top">单指拖动 RSTL，双指缩放和移动图片。</Hint>
      <ButtonRow className="live-refine-primary-actions">
        <Button variant="workbench" id="refine2dBtn" type="button" disabled aria-pressed="false">微调</Button>
        <Button variant="workbench" id="refineUndoBtn" type="button" disabled>撤销</Button>
        <Button variant="workbench" id="refineResetBtn" type="button" disabled>恢复</Button>
      </ButtonRow>
      <div className="live-refine-panel hidden" id="refine2dPanel">
        <div className="live-refine-quality hidden" id="refine2dQuality" data-state="idle" role="status" />
        <Hint id="refine2dHint">点按“微调”后，单指拖动线条；双指可缩放图片。</Hint>
      </div>
      <div className="live-refine-internal" aria-hidden="true">
        <span id="refine2dStatus">未开始</span>
        <button id="refineViewBtn" type="button" />
        <button id="refineDragBtn" type="button" />
        <button id="refinePointBtn" type="button" />
        <button id="refineEraseBtn" type="button" />
        <button id="refineExportBtn" type="button" />
        <button id="refineZoomOutBtn" type="button" />
        <button id="refineZoomResetBtn" type="button" />
        <button id="refineZoomInBtn" type="button" />
        <output id="refineZoomVal">100%</output>
        <input id="refineSpread" type="range" min="12" max="60" step="1" defaultValue="28" />
        <output id="refineSpreadVal">28%</output>
        <div id="refinePointCountWrap"><input id="refinePointCount" type="range" min="1" max="30" step="1" defaultValue="1" /></div>
        <output id="refinePointCountVal">1 个点</output>
        <select id="refineNudgeStep" defaultValue="0.5"><option value="0.5">0.5 px</option></select>
        <input id="refineSymmetryToggle" type="checkbox" />
        <input id="refineAxisToggle" type="checkbox" defaultChecked />
      </div>
    </Card>
  );
}
