import { AnnotateWorkbench } from "./AnnotateWorkbench";
import { ManagedWorkbenchRoute } from "../components/ManagedWorkbenchRoute";
import { useAnnotateControllerBridge } from "../hooks/useAnnotateControllerBridge";

type AnnotateRuntime = typeof import("../services/annotateRuntime");

const loadAnnotateRuntime = () => import("../services/annotateRuntime");
const mountAnnotateRuntime = (runtime: AnnotateRuntime, root: HTMLElement) =>
  runtime.mountAnnotateWorkbench(root);

export function AnnotateRoute() {
  useAnnotateControllerBridge();

  return (
    <ManagedWorkbenchRoute
      failedStatus="3D 标注加载失败"
      legacyNotice="图谱管理工具：用于标准图谱生产和复核，不保存患者或病例信息。"
      loadModule={loadAnnotateRuntime}
      loadingStatus="加载 3D 标注"
      mount={mountAnnotateRuntime}
      mountedStatus="3D 标注已挂载"
      unloadedStatus="3D 标注已卸载"
      workspace="annotate"
    >
      <AnnotateWorkbench />
    </ManagedWorkbenchRoute>
  );
}
