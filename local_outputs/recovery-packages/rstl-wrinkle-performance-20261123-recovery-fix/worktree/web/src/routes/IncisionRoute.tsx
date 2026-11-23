import { IncisionWorkbench } from "./IncisionWorkbench";
import { ManagedWorkbenchRoute } from "../components/ManagedWorkbenchRoute";
import { useIncisionControllerBridge } from "../hooks/useIncisionControllerBridge";

type IncisionRuntime = typeof import("../services/incisionRuntime");

const loadIncisionRuntime = () => import("../services/incisionRuntime");
const mountIncisionRuntime = (runtime: IncisionRuntime, root: HTMLElement) =>
  runtime.mountIncisionWorkbench(root);

export function IncisionRoute() {
  useIncisionControllerBridge();

  return (
    <ManagedWorkbenchRoute
      failedStatus="切口工作台加载失败"
      loadModule={loadIncisionRuntime}
      loadingStatus="加载切口工作台"
      mount={mountIncisionRuntime}
      mountedStatus="切口工作台已挂载"
      unloadedStatus="切口工作台已卸载"
      workspace="incision"
    >
      <IncisionWorkbench />
    </ManagedWorkbenchRoute>
  );
}
