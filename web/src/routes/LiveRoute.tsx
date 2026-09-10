import { LiveWorkbench } from "./LiveWorkbench";
import { ManagedWorkbenchRoute } from "../components/ManagedWorkbenchRoute";
import { useLiveControllerBridge } from "../hooks/useLiveControllerBridge";

type LiveRuntime = typeof import("../services/liveRuntime");

const loadLiveRuntime = () => import("../services/liveRuntime");
const mountLiveRuntime = (runtime: LiveRuntime, root: HTMLElement) =>
  runtime.mountLiveWorkbench(root);

export function LiveRoute() {
  useLiveControllerBridge();

  return (
    <ManagedWorkbenchRoute
      failedStatus="实时显示加载失败"
      legacyNotice="实时张力线研究工具：在当前浏览器会话中处理摄像头或照片。"
      loadModule={loadLiveRuntime}
      loadingStatus="加载实时显示"
      mount={mountLiveRuntime}
      mountedStatus="实时显示已挂载"
      unloadedStatus="实时显示已卸载"
      workspace="live"
    >
      <LiveWorkbench />
    </ManagedWorkbenchRoute>
  );
}
