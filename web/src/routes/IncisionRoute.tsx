import { useRef } from "react";

import { IncisionWorkbench } from "./IncisionWorkbench";
import { useIncisionControllerBridge } from "../hooks/useIncisionControllerBridge";
import { useManagedWorkbenchController } from "../hooks/useManagedWorkbenchController";

type IncisionControllerModule = typeof import("../../incision_agent_main.js");

const loadIncisionController = () => import("../../incision_agent_main.js");
const mountIncisionController = (module: IncisionControllerModule, root: HTMLElement) => module.mountIncisionAgentWorkbench(root);
const disposeIncisionController = (module: IncisionControllerModule) => module.disposeIncisionAgentWorkbench?.();

export function IncisionRoute() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useIncisionControllerBridge();

  useManagedWorkbenchController({
    hostRef,
    workspace: "incision",
    loadingStatus: "加载切口工作台",
    mountedStatus: "切口工作台已挂载",
    failedStatus: "切口工作台加载失败",
    unloadedStatus: "切口工作台已卸载",
    loadModule: loadIncisionController,
    mount: mountIncisionController,
    dispose: disposeIncisionController,
  });

  return (
    <div ref={hostRef} className="react-incision-host">
      <IncisionWorkbench />
    </div>
  );
}
