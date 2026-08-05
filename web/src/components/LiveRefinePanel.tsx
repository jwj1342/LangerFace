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
        <ButtonRow className="live-refine-three">
          <Button variant="workbench" id="refineViewBtn" type="button" aria-pressed="true">查看</Button>
          <Button variant="workbench" id="refineDragBtn" type="button">拖点</Button>
          <Button variant="workbench" id="refineEraseBtn" type="button">擦除</Button>
        </ButtonRow>
        <ButtonRow>
          <Button variant="workbench" id="refineUndoBtn" type="button" disabled>撤销</Button>
          <Button variant="workbench" id="refineExportBtn" type="button" disabled>导出</Button>
        </ButtonRow>
        <CheckboxField checkboxProps={{ id: "refineSymmetryToggle", defaultChecked: true }}>对称联动</CheckboxField>
        <CheckboxField checkboxProps={{ id: "refineAxisToggle", defaultChecked: true }}>显示人脸中线</CheckboxField>
        <Button variant="workbench" id="refineResetBtn" type="button">恢复自动结果</Button>
        <Hint id="refine2dHint">上传正脸照片或定格摄像头：拖点会平滑联动整条线，擦除会隐藏整条线且可撤销。</Hint>
      </div>
    </Card>
  );
}
