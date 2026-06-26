import { AnnotateWorkbench } from "./AnnotateWorkbench";
import { ManagedWorkbenchRoute } from "../components/ManagedWorkbenchRoute";
import { useAnnotateControllerBridge } from "../hooks/useAnnotateControllerBridge";

type AnnotateControllerModule = typeof import("../../annotate_main.js");

const loadAnnotateController = () => import("../../annotate_main.js");
const mountAnnotateController = (module: AnnotateControllerModule, root: HTMLElement) => module.mountAnnotateWorkbench(root);
const disposeAnnotateController = (module: AnnotateControllerModule) => module.disposeAnnotateWorkbench?.();

export function AnnotateRoute() {
  useAnnotateControllerBridge();

  return (
    <ManagedWorkbenchRoute
      dispose={disposeAnnotateController}
      failedStatus="3D 标注加载失败"
      loadingStatus="加载 3D 标注"
      loadModule={loadAnnotateController}
      mount={mountAnnotateController}
      mountedStatus="3D 标注已挂载"
      unloadedStatus="3D 标注已卸载"
      workspace="annotate"
    >
      <AnnotateWorkbench />
    </ManagedWorkbenchRoute>
  );
}
