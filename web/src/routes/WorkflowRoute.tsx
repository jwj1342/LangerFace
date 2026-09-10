import { ManagedWorkbenchRoute } from "../components/ManagedWorkbenchRoute";
import { useIncisionControllerBridge } from "../hooks/useIncisionControllerBridge";
import { useLiveControllerBridge } from "../hooks/useLiveControllerBridge";
import { WorkflowWorkbench } from "./WorkflowWorkbench";

type LiveRuntime = typeof import("../services/liveRuntime");
type WorkflowIncisionController = typeof import("../services/workflowIncisionController");
interface WorkflowModules {
  live: LiveRuntime;
  incision: WorkflowIncisionController;
}

const loadWorkflowModules = async (): Promise<WorkflowModules> => {
  const [live, incision] = await Promise.all([
    import("../services/liveRuntime"),
    import("../services/workflowIncisionController"),
  ]);
  return { live, incision };
};

const mountWorkflowModules = (modules: WorkflowModules, root: HTMLElement) => {
  const disposeLive = modules.live.mountLiveWorkbench(root);
  const disposeIncision = modules.incision.mountWorkflowIncisionController(root);
  return () => {
    disposeIncision();
    disposeLive();
  };
};

export function WorkflowRoute() {
  useLiveControllerBridge();
  useIncisionControllerBridge();

  return (
    <ManagedWorkbenchRoute
      failedStatus="合并工作台加载失败"
      loadModule={loadWorkflowModules}
      loadingStatus="加载合并工作台"
      mount={mountWorkflowModules}
      mountedStatus="合并工作台已挂载"
      unloadedStatus="合并工作台已卸载"
      workspace="workflow"
    >
      <WorkflowWorkbench />
    </ManagedWorkbenchRoute>
  );
}
