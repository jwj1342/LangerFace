import { useRef } from "react";

import { LiveWorkbench } from "./LiveWorkbench";
import { useLiveControllerBridge } from "../hooks/useLiveControllerBridge";
import { useManagedWorkbenchController } from "../hooks/useManagedWorkbenchController";

type LiveControllerModule = typeof import("../../main.js");

const loadLiveController = () => import("../../main.js");
const mountLiveController = (module: LiveControllerModule, root: HTMLElement) => module.mountLiveWorkbench(root);
const disposeLiveController = (module: LiveControllerModule) => module.disposeLiveWorkbench?.();

export function LiveRoute() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useLiveControllerBridge();

  useManagedWorkbenchController({
    hostRef,
    workspace: "live",
    loadingStatus: "加载实时显示",
    mountedStatus: "实时显示已挂载",
    failedStatus: "实时显示加载失败",
    unloadedStatus: "实时显示已卸载",
    loadModule: loadLiveController,
    mount: mountLiveController,
    dispose: disposeLiveController,
  });

  return (
    <div ref={hostRef} className="react-live-host">
      <LiveWorkbench />
    </div>
  );
}
