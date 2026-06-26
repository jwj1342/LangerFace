import { IncisionWorkbench } from "./IncisionWorkbench";
import { ManagedWorkbenchRoute } from "../components/ManagedWorkbenchRoute";
import { useIncisionControllerBridge } from "../hooks/useIncisionControllerBridge";

type IncisionControllerModule = typeof import("../../incision_agent_main.js");

const loadIncisionController = () => import("../../incision_agent_main.js");
const mountIncisionController = (module: IncisionControllerModule, root: HTMLElement) => module.mountIncisionAgentWorkbench(root);
const disposeIncisionController = (module: IncisionControllerModule) => module.disposeIncisionAgentWorkbench?.();

export function IncisionRoute() {
  useIncisionControllerBridge();

  return (
    <ManagedWorkbenchRoute
      dispose={disposeIncisionController}
      failedStatus="切口工作台加载失败"
      loadingStatus="加载切口工作台"
      loadModule={loadIncisionController}
      mount={mountIncisionController}
      mountedStatus="切口工作台已挂载"
      unloadedStatus="切口工作台已卸载"
      workspace="incision"
    >
      <IncisionWorkbench />
    </ManagedWorkbenchRoute>
  );
}
