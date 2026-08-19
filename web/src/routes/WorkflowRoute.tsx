import { ManagedWorkbenchRoute } from "../components/ManagedWorkbenchRoute";
import { useLiveControllerBridge } from "../hooks/useLiveControllerBridge";
import { WorkflowWorkbench } from "./WorkflowWorkbench";

type LiveRuntime = typeof import("../services/liveRuntime");

const loadLiveRuntime = () => import("../services/liveRuntime");
const mountLiveRuntime = (runtime: LiveRuntime, root: HTMLElement) =>
  runtime.mountLiveWorkbench(root);

export function WorkflowRoute() {
  useLiveControllerBridge();

  return (
    <ManagedWorkbenchRoute
      failedStatus="合并工作台加载失败"
      loadModule={loadLiveRuntime}
      loadingStatus="加载合并工作台"
      mount={mountLiveRuntime}
      mountedStatus="合并工作台已挂载"
      unloadedStatus="合并工作台已卸载"
      workspace="workflow"
    >
      <WorkflowWorkbench />
    </ManagedWorkbenchRoute>
  );
}
