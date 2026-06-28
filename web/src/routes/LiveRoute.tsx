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
      legacyNotice="兼容工具：正式临床流程请从病例大厅进入，本页用于实时张力线评估。"
      loadingStatus="加载实时显示"
      mountedStatus="实时显示已挂载"
      unloadedStatus="实时显示已卸载"
      workspace="live"
    >
      <LiveWorkbench />
    </ManagedWorkbenchRoute>
  );
}
