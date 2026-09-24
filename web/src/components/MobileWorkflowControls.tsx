import { Camera, Download, ImagePlus, Pause, Play, ScanLine } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useIncisionControllerCommands, useLiveControllerCommands } from "../hooks/useControllerCommands";
import {
  setMobileIncisionCandidateVisible,
  setMobileRstlLayerVisible,
  setMobileWrinkleLayerVisible,
  subscribeWorkflowLayerVisibility,
  workflowLayerVisibilitySnapshot,
} from "../services/mobileWorkflowVisibility";
import { useIncisionStore } from "../stores/incisionStore";
import { useLiveStore } from "../stores/liveStore";
import { Button } from "./ui/button";
import { FieldValue, Label } from "./ui/label";
import { RangeInput } from "./ui/slider";

type WrinkleDisplayMode = "rstl" | "wrinkles" | "both";

function displayModeFlags(mode: WrinkleDisplayMode) {
  return {
    rstl: mode === "rstl" || mode === "both",
    wrinkles: mode === "wrinkles" || mode === "both",
  };
}

function readWrinkleDisplayMode(): WrinkleDisplayMode {
  const value = document.querySelector<HTMLSelectElement>("#wrinkleDisplayMode")?.value;
  return value === "rstl" || value === "wrinkles" ? value : "both";
}

function writeWrinkleDisplayMode(mode: WrinkleDisplayMode) {
  const select = document.querySelector<HTMLSelectElement>("#wrinkleDisplayMode");
  if (!select) return;
  select.value = mode;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

export function MobileWorkflowControls() {
  const liveCommands = useLiveControllerCommands();
  const liveSnapshot = useLiveStore((state) => state.snapshot);
  const running = Boolean(liveSnapshot?.source.running);
  const paused = Boolean(liveSnapshot?.source.paused);
  const recording = Boolean(liveSnapshot?.recording);
  const cameraActive = running && liveSnapshot?.source.kind === "camera";
  const hasSource = running || Boolean(liveSnapshot?.source.kind);

  useEffect(() => {
    if (!cameraActive) return;
    // Camera startup resets the wrinkle runtime. Re-apply the visible phone
    // controls afterwards so their pressed state and both render gates agree.
    setMobileRstlLayerVisible(true);
    setMobileWrinkleLayerVisible(true);
    writeWrinkleDisplayMode("both");
  }, [cameraActive]);

  return (
    <section className="mobile-workflow-dock" aria-label="移动端常用操作">
      <div className="mobile-workflow-section">
        <div className="mobile-workflow-heading">
          <span>输入</span>
          <small>{liveSnapshot?.source.liveLabel || "待机"}</small>
        </div>
        <div className="mobile-source-grid">
          <Button variant="workbenchPrimary" type="button" onClick={() => liveCommands.source("upload_source")}>
            <ImagePlus size={15} /> 上传照片
          </Button>
          <Button
            variant="workbench"
            type="button"
            aria-pressed={cameraActive}
            onClick={() => liveCommands.source("camera_toggle")}
          >
            <Camera size={15} /> {cameraActive ? "关闭后置摄像头" : "开启后置摄像头"}
          </Button>
          <Button variant="workbench" type="button" disabled={!running} onClick={() => liveCommands.source("pause_toggle")}>
            {paused ? <Play size={15} /> : <Pause size={15} />} {paused ? "继续" : "暂停"}
          </Button>
          <Button
            variant="workbench"
            type="button"
            disabled={!hasSource}
            aria-pressed={recording || undefined}
            onClick={() => liveCommands.source("recording_toggle")}
          >
            <Download size={15} /> {recording ? "停止视频" : "导出视频"}
          </Button>
          <Button
            variant="workbench"
            type="button"
            disabled={!hasSource}
            onClick={() => liveCommands.source("image_export")}
          >
            <ImagePlus size={15} /> 导出图片
          </Button>
        </div>
      </div>
      <div className="mobile-workflow-section">
        <div className="mobile-workflow-heading">
          <span>叠加图层</span>
          <small>可全部隐藏，结果仍会保留</small>
        </div>
        <WorkflowLayerVisibilityButtons className="mobile-layer-grid" mobile />
      </div>
    </section>
  );
}

export function WorkflowLayerVisibilityButtons({ className = "", mobile = false }: { className?: string; mobile?: boolean }) {
  const visibility = useSyncExternalStore(
    subscribeWorkflowLayerVisibility,
    workflowLayerVisibilitySnapshot,
    workflowLayerVisibilitySnapshot,
  );

  useEffect(() => {
    const select = document.querySelector<HTMLSelectElement>("#wrinkleDisplayMode");
    const sync = () => {
      const flags = displayModeFlags(readWrinkleDisplayMode());
      setMobileRstlLayerVisible(flags.rstl);
      setMobileWrinkleLayerVisible(flags.wrinkles);
    };
    select?.addEventListener("change", sync);
    return () => select?.removeEventListener("change", sync);
  }, []);

  const toggleWrinkleLayer = (layer: "rstl" | "wrinkles") => {
    const nextRstl = layer === "rstl" ? !visibility.rstl : visibility.rstl;
    const nextWrinkles = layer === "wrinkles" ? !visibility.wrinkles : visibility.wrinkles;
    setMobileRstlLayerVisible(nextRstl);
    setMobileWrinkleLayerVisible(nextWrinkles);
    if (nextRstl || nextWrinkles) {
      writeWrinkleDisplayMode(nextRstl && nextWrinkles ? "both" : nextRstl ? "rstl" : "wrinkles");
    }
  };

  return (
    <div className={`workflow-layer-grid ${className}`.trim()} role="group" aria-label="叠加图层显示开关">
      <Button variant="workbench" type="button" className={mobile ? "mobile-layer-toggle" : "workflow-layer-toggle"} aria-pressed={visibility.rstl} onClick={() => toggleWrinkleLayer("rstl")}>RSTL</Button>
      <Button variant="workbench" type="button" className={mobile ? "mobile-layer-toggle" : "workflow-layer-toggle"} aria-pressed={visibility.wrinkles} onClick={() => toggleWrinkleLayer("wrinkles")}>皱纹</Button>
      <Button variant="workbench" type="button" className={mobile ? "mobile-layer-toggle" : "workflow-layer-toggle"} aria-pressed={visibility.incision} onClick={() => setMobileIncisionCandidateVisible(!visibility.incision)}>切口线</Button>
    </div>
  );
}

export function MobileCandidateAdjustPanel() {
  const commands = useIncisionControllerCommands();
  const snapshot = useIncisionStore((state) => state.snapshot);
  const cameraMode = useLiveStore((state) => state.snapshot?.source.kind === "camera");
  const edit = snapshot?.edit;
  const candidateReady = Boolean(edit?.widthScaleVisible);
  const [scalePct, setScalePct] = useState("0");
  const [angleDeg, setAngleDeg] = useState("0");
  const cancelledGesture = useRef({ uniformScale: false, angleOffsetDeg: false });

  useEffect(() => {
    if (!edit) return;
    setScalePct(String(Math.max(0, Math.max(edit.lengthScalePct, edit.widthScalePct) - 100)));
    setAngleDeg(String(edit.angleOffsetDeg));
  }, [edit?.angleOffsetDeg, edit?.lengthScalePct, edit?.widthScalePct]);

  const previewUniformScale = (value: string) => {
    commands.edit("preview_edit", "uniformScale", value);
  };
  const commitUniformScale = (value: string) => {
    commands.edit("commit_edit", "uniformScale", value);
  };

  return (
    <section className="mobile-candidate-adjust" aria-label="移动端候选调整">
      <header>
        <div>
          <span>候选微调</span>
          <small>绕切口中心调整 · 仅调整梭形草案</small>
        </div>
        <ScanLine size={18} aria-hidden="true" />
      </header>
      <div className="mobile-adjust-field">
        <Label htmlFor="mobileFusiformScale">梭形整体缩放 <FieldValue>{scalePct}%</FieldValue></Label>
        <RangeInput
          id="mobileFusiformScale"
          min="0"
          max="50"
          step="1"
          value={scalePct}
          disabled={cameraMode || !candidateReady}
          onPointerDown={() => { cancelledGesture.current.uniformScale = false; }}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setScalePct(value);
            previewUniformScale(value);
          }}
          onPointerUp={(event) => {
            cancelledGesture.current.uniformScale = false;
            commitUniformScale(event.currentTarget.value);
          }}
          onPointerCancel={() => {
            cancelledGesture.current.uniformScale = true;
            commands.edit("cancel_edit", "uniformScale");
          }}
          onKeyUp={(event) => commitUniformScale(event.currentTarget.value)}
          onBlur={(event) => {
            if (cancelledGesture.current.uniformScale) {
              cancelledGesture.current.uniformScale = false;
              return;
            }
            commitUniformScale(event.currentTarget.value);
          }}
          onChange={(event) => setScalePct(event.currentTarget.value)}
        />
        <small>0% 为基础梭形；长度和宽度围绕中心等比放大，不替代以毫米记录的医学安全切缘。</small>
      </div>
      <div className="mobile-adjust-field">
        <Label htmlFor="mobileFusiformAngle">切口方向 <FieldValue>{Number(angleDeg) > 0 ? "+" : ""}{angleDeg}°</FieldValue></Label>
        <RangeInput
          id="mobileFusiformAngle"
          min="-35"
          max="35"
          step="1"
          value={angleDeg}
          disabled={cameraMode || !candidateReady}
          onPointerDown={() => { cancelledGesture.current.angleOffsetDeg = false; }}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setAngleDeg(value);
            commands.edit("preview_edit", "angleOffsetDeg", value);
          }}
          onPointerUp={(event) => {
            cancelledGesture.current.angleOffsetDeg = false;
            commands.edit("commit_edit", "angleOffsetDeg", event.currentTarget.value);
          }}
          onPointerCancel={() => {
            cancelledGesture.current.angleOffsetDeg = true;
            commands.edit("cancel_edit", "angleOffsetDeg");
          }}
          onKeyUp={(event) => commands.edit("commit_edit", "angleOffsetDeg", event.currentTarget.value)}
          onBlur={(event) => {
            if (cancelledGesture.current.angleOffsetDeg) {
              cancelledGesture.current.angleOffsetDeg = false;
              return;
            }
            commands.edit("commit_edit", "angleOffsetDeg", event.currentTarget.value);
          }}
          onChange={(event) => setAngleDeg(event.currentTarget.value)}
        />
        <small>拖动滑杆，以切口中心为轴心旋转；保持 3:1 并重新包住肿物，人工方向优先。</small>
      </div>
    </section>
  );
}
