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
      legacyNotice="图谱管理工具：用于标准图谱生产和复核，不属于医生病例主流程。"
      loadingStatus="加载 3D 标注"
      mountedStatus="3D 标注已挂载"
      unloadedStatus="3D 标注已卸载"
      workspace="annotate"
    >
      <AnnotateWorkbench />
    </ManagedWorkbenchRoute>
  );
}
