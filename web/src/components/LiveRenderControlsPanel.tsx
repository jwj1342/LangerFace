import { useState } from "react";

import { dispatchLiveRenderCommand } from "../lib/controllerCommand";
import { useLiveStore } from "../stores/liveStore";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { CheckboxField } from "./ui/checkbox-field";
import { FieldGroup } from "./ui/field-group";
import { Hint } from "./ui/hint";
import { FieldValue, Label } from "./ui/label";
import { Select } from "./ui/select";
import { RangeInput } from "./ui/slider";

export function LiveRenderControlsPanel() {
  const snapshot = useLiveStore((state) => state.snapshot);
  const render = snapshot?.render;
  const atlasPreview = snapshot?.atlasPreview;
  const [density, setDensity] = useState(render?.densityPct || 100);
  const [opacity, setOpacity] = useState(render?.opacityPct || 92);
  const mirror = render?.mirror ?? true;
  const meshPts = render?.meshPts ?? false;

  return (
    <>
      <Card>
        <FieldGroup>
          <Label htmlFor="templateSel">模板</Label>
          <Select
            id="templateSel"
            className="live-inline-top"
            defaultValue={render?.system || "rstl"}
            onChange={(event) => dispatchLiveRenderCommand("template_change", event.currentTarget.value)}
          >
            <option value="rstl">面部 RSTL 指南（首选）</option>
          </Select>
          <Hint visible={Boolean(atlasPreview?.active)} id="atlasProvenance">
            {atlasPreview?.active ? `${atlasPreview.source || "标注会话"} · ${atlasPreview.count ?? 0} 条线` : ""}
          </Hint>
          <Button variant="workbench" visible={Boolean(atlasPreview?.active)} id="restoreAtlasBtn" type="button" onClick={() => dispatchLiveRenderCommand("restore_atlas")}>恢复官方图谱</Button>
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor="density">线密度 <FieldValue id="densityVal">{density}%</FieldValue></Label>
          <RangeInput
            id="density"
            min="12"
            max="100"
            value={density}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              setDensity(value);
              dispatchLiveRenderCommand("density_input", value);
            }}
          />
        </FieldGroup>
        <FieldGroup visible={false}>
          <Label htmlFor="smooth">平滑 <FieldValue id="smoothVal">{render?.smoothLabel || "中"}</FieldValue></Label>
          <RangeInput id="smooth" min="0" max="100" defaultValue="60" />
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor="opacity">透明度 <FieldValue id="opacityVal">{opacity}%</FieldValue></Label>
          <RangeInput
            id="opacity"
            min="25"
            max="100"
            value={opacity}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              setOpacity(value);
              dispatchLiveRenderCommand("opacity_input", value);
            }}
          />
        </FieldGroup>
      </Card>

      <Card>
        <CheckboxField visible={false} checkboxProps={{ id: "clip", defaultChecked: true }}>限制在面部轮廓内（背面剔除）</CheckboxField>
        <CheckboxField visible={false} checkboxProps={{ id: "handOcc", defaultChecked: true }}>前方手部遮挡（仅识别手部）</CheckboxField>
        <CheckboxField
          checkboxProps={{
            id: "mirror",
            checked: mirror,
            onChange: (event) => dispatchLiveRenderCommand("mirror_toggle", event.currentTarget.checked),
          }}
        >
          镜像（自拍视角）
        </CheckboxField>
        <CheckboxField visible={false} checkboxProps={{ id: "bands" }}>按面部分区着色</CheckboxField>
        <CheckboxField visible={false} checkboxProps={{ id: "zoom", defaultChecked: true }}>细节放大窗（关键区域）</CheckboxField>
        <CheckboxField
          checkboxProps={{
            id: "meshPts",
            checked: meshPts,
            onChange: (event) => dispatchLiveRenderCommand("mesh_points_toggle", event.currentTarget.checked),
          }}
        >
          显示网格采样点
        </CheckboxField>
      </Card>
    </>
  );
}
