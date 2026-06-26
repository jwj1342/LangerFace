import { LiveWorkbench } from "./LiveWorkbench";
import { ManagedWorkbenchRoute } from "../components/ManagedWorkbenchRoute";
import { useLiveControllerBridge } from "../hooks/useLiveControllerBridge";

type LiveControllerModule = typeof import("../../main.js");

const loadLiveController = () => import("../../main.js");
const mountLiveController = (module: LiveControllerModule, root: HTMLElement) => module.mountLiveWorkbench(root);
const disposeLiveController = (module: LiveControllerModule) => module.disposeLiveWorkbench?.();

export function LiveRoute() {
  useLiveControllerBridge();

  return (
    <ManagedWorkbenchRoute
      dispose={disposeLiveController}
      failedStatus="实时显示加载失败"
      loadingStatus="加载实时显示"
      loadModule={loadLiveController}
      mount={mountLiveController}
      mountedStatus="实时显示已挂载"
      unloadedStatus="实时显示已卸载"
      workspace="live"
    >
      <LiveWorkbench />
    </ManagedWorkbenchRoute>
  );
}
