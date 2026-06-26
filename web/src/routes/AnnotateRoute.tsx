import { AnnotateWorkbench } from "./AnnotateWorkbench";
import { ManagedWorkbenchRoute } from "../components/ManagedWorkbenchRoute";
import { useAnnotateControllerBridge } from "../hooks/useAnnotateControllerBridge";
import { annotateLegacyController } from "../services/legacyControllers";

export function AnnotateRoute() {
  useAnnotateControllerBridge();

  return (
    <ManagedWorkbenchRoute
      controller={annotateLegacyController}
      failedStatus="3D 标注加载失败"
      loadingStatus="加载 3D 标注"
      mountedStatus="3D 标注已挂载"
      unloadedStatus="3D 标注已卸载"
      workspace="annotate"
    >
      <AnnotateWorkbench />
    </ManagedWorkbenchRoute>
  );
}
