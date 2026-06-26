import { Link } from "react-router-dom";

import { dispatchLiveRouteCommand } from "../lib/controllerCommand";
import { useLiveStore } from "../stores/liveStore";
import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { Card } from "./ui/card";
import { CheckboxField } from "./ui/checkbox-field";
import { FieldGroup } from "./ui/field-group";
import { Hint } from "./ui/hint";
import { Label } from "./ui/label";
import { ProgressBar } from "./ui/progress";
import { Select } from "./ui/select";

export function LiveRouteControlsPanel() {
  const snapshot = useLiveStore((state) => state.snapshot);
  const route = snapshot?.route.route || "2d";
  const mode3d = snapshot?.route.mode3d || "view";
  const recon = snapshot?.recon;
  const is3d = route === "3d";
  const hasModel = Boolean(recon?.has3dModel);
  const projectable = Boolean(recon?.projectable);
  const scanning = Boolean(recon?.scanActive);
  const twinActive = mode3d === "twin";

  return (
    <>
      <Card>
        <Label htmlFor="routeSel">技术路线</Label>
        <Select
          id="routeSel"
          className="live-inline-top"
          value={route}
          onChange={(event) => dispatchLiveRouteCommand("route_change", event.currentTarget.value)}
        >
          <option value="2d">2D 贴合（默认，稳定）</option>
          <option value="3d">3D 重建（Beta）</option>
        </Select>
        <Hint className="live-inline-top" id="routeModeHint">
          {snapshot?.route.hint || "当前是 2D 实时贴合模式，只显示稳定主流程。"}
        </Hint>
        <FieldGroup id="route3dPanel" className="live-stack" visible={is3d}>
          <ButtonRow className="live-two-col">
            <Button variant="workbench" id="reconDemoBtn" type="button" disabled={scanning} onClick={() => dispatchLiveRouteCommand("load_demo_recon")}>用示例脸（无摄像头）</Button>
            <Button variant="workbench" id="reconScanBtn" type="button" disabled={scanning} onClick={() => dispatchLiveRouteCommand("start_scan")}>转头扫描</Button>
          </ButtonRow>
          <Hint id="reconStatus">{recon?.status || "先重建你的 3D 人头 → 可旋转查看 → 再投影到实时画面。"}</Hint>
          <FieldGroup className="scan-panel" id="scanPanel" visible={scanning}>
            <div className="scan-row"><span>扫描进度</span><span id="scanProgressVal">0%</span></div>
            <ProgressBar fillProps={{ id: "scanProgressBar" }} />
            <div className="scan-row"><span>角度覆盖</span><span id="scanYawVal">0.00</span></div>
            <div className="yaw-meter">
              <span id="scanYawLeft" />
              <span id="scanYawMid" />
              <span id="scanYawRight" />
            </div>
          </FieldGroup>
          <ButtonRow className="live-two-col">
            <Button variant="workbench" id="view3dBtn" type="button" disabled={!hasModel} aria-pressed={mode3d === "view"} onClick={() => dispatchLiveRouteCommand("view_3d")}>旋转查看</Button>
            <Button variant="workbench" id="project3dBtn" type="button" disabled={!hasModel || !projectable} aria-pressed={mode3d === "project"} onClick={() => dispatchLiveRouteCommand("project_3d")}>投影到画面</Button>
          </ButtonRow>
          <Button variant="workbench" id="reset3dBtn" type="button" disabled={!hasModel} onClick={() => dispatchLiveRouteCommand("reset_3d")}>复位视角</Button>
          <Button variant="workbenchPrimary" id="cloudFitFlameBtn" type="button" disabled={scanning} onClick={() => dispatchLiveRouteCommand("start_twin")}>▶ 实时孪生（左真脸 / 右 FLAME 随动）</Button>
          <CheckboxField
            id="flameHeadToggleWrap"
            hiddenClassName="live-hidden-inline"
            visible={twinActive}
            checkboxProps={{
              id: "flameStdToggle",
              checked: recon?.twinMode === "standard",
              onChange: (event) => dispatchLiveRouteCommand("toggle_twin_head", event.currentTarget.checked),
            }}
          >
            显示标准头（取消勾选 = 个体）
          </CheckboxField>
          <CheckboxField
            id="twinTextureWrap"
            hiddenClassName="live-hidden-inline"
            visible={twinActive}
            checkboxProps={{
              id: "twinTextureToggle",
              checked: Boolean(recon?.twinTexture),
              onChange: (event) => dispatchLiveRouteCommand("toggle_twin_texture", event.currentTarget.checked),
            }}
          >
            贴真实人脸纹理
          </CheckboxField>
        </FieldGroup>
      </Card>

      <Card id="threeDWorkflowCard" visible={is3d}>
        <div>
          <Label>3D 线标注与研究演示</Label>
          <Hint className="live-inline-top">在 3D 标准脸上绘制 RSTL 候选线，并从标注页进入沿 RSTL 闭合力学演示。</Hint>
        </div>
        <Button asChild variant="workbenchPrimary">
          <Link to="/annotate">打开 3D 线标注</Link>
        </Button>
      </Card>
    </>
  );
}
