import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { Card } from "./ui/card";
import { CheckboxField } from "./ui/checkbox-field";

export function LiveRefinePanel() {
  return (
    <Card id="liveRefineCard">
      <Button variant="workbench" id="refine2dBtn" type="button" disabled aria-pressed="false">医生手动微调</Button>
      <div className="live-refine-panel hidden" id="refine2dPanel">
        <div className="live-refine-status"><span>当前状态</span><span id="refine2dStatus">未开始</span></div>
        <div className="live-refine-quality" id="refine2dQuality" data-state="idle" role="status">质量检查将在修改后运行。</div>
        <ButtonRow className="live-refine-modes">
          <Button variant="workbench" id="refineViewBtn" type="button" aria-pressed="true">查看</Button>
          <Button variant="workbench" id="refineDragBtn" type="button" visible={false}>拖线</Button>
          <Button variant="workbench" id="refinePointBtn" type="button">拖点</Button>
          <Button variant="workbench" id="refineEraseBtn" type="button">隐藏</Button>
        </ButtonRow>
        <ButtonRow className="live-refine-actions">
          <Button variant="workbench" id="refineUndoBtn" type="button" disabled>撤销</Button>
          <Button variant="workbench" id="refineExportBtn" type="button" disabled>导出</Button>
        </ButtonRow>
        <div className="live-refine-zoom">
          <label className="live-refine-range" htmlFor="refineZoomResetBtn">
            <span>图片缩放</span><output id="refineZoomVal">100%</output>
          </label>
          <ButtonRow className="live-refine-zoom-actions" aria-label="图片缩放">
            <Button variant="workbench" id="refineZoomOutBtn" type="button" aria-label="缩小图片">−</Button>
            <Button variant="workbench" id="refineZoomResetBtn" type="button">还原</Button>
            <Button variant="workbench" id="refineZoomInBtn" type="button" aria-label="放大图片">＋</Button>
          </ButtonRow>
        </div>
        <label className="live-refine-range" htmlFor="refineSpread" hidden>
          <span>拖线联动范围</span><output id="refineSpreadVal">28%</output>
        </label>
        <input id="refineSpread" type="range" min="12" max="60" step="1" defaultValue="28" hidden />
        <div className="live-refine-point-count hidden" id="refinePointCountWrap">
          <label className="live-refine-range" htmlFor="refinePointCount">
            <span>拖点数量</span><output id="refinePointCountVal">1 个点</output>
          </label>
          <input id="refinePointCount" type="range" min="1" max="30" step="1" defaultValue="1" />
        </div>
        <div className="live-refine-nudge-head" hidden>
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
        <ButtonRow className="live-refine-nudge" aria-label="选中位置精调" hidden>
          <Button variant="workbench" type="button" data-refine-nudge="left" aria-label="向左精调">←</Button>
          <Button variant="workbench" type="button" data-refine-nudge="up" aria-label="向上精调">↑</Button>
          <Button variant="workbench" type="button" data-refine-nudge="down" aria-label="向下精调">↓</Button>
          <Button variant="workbench" type="button" data-refine-nudge="right" aria-label="向右精调">→</Button>
        </ButtonRow>
        <CheckboxField visible={false} checkboxProps={{ id: "refineSymmetryToggle" }}>对称联动（可选）</CheckboxField>
        <CheckboxField visible={false} checkboxProps={{ id: "refineAxisToggle", defaultChecked: true }}>显示人脸中线</CheckboxField>
        <Button variant="workbench" id="refineResetBtn" type="button">恢复自动结果</Button>
        <div className="hidden" id="refine2dHint" aria-hidden="true" />
      </div>
    </Card>
  );
}
