import { LiveWorkbench } from "./LiveWorkbench";
import { ManagedWorkbenchRoute } from "../components/ManagedWorkbenchRoute";
import { useLiveControllerBridge } from "../hooks/useLiveControllerBridge";
import { liveLegacyController } from "../services/legacyControllers";

export function LiveRoute() {
  useLiveControllerBridge();

  return (
    <ManagedWorkbenchRoute
      controller={liveLegacyController}
      failedStatus="实时显示加载失败"
      legacyNotice="实时张力线研究工具：在当前浏览器会话中处理摄像头、照片或视频。"
      loadingStatus="加载实时显示"
      mountedStatus="实时显示已挂载"
      unloadedStatus="实时显示已卸载"
      workspace="live"
    >
      <LiveWorkbench />
    </ManagedWorkbenchRoute>
  );
}
