import { IncisionWorkbench } from "./IncisionWorkbench";
import { ManagedWorkbenchRoute } from "../components/ManagedWorkbenchRoute";
import { useIncisionControllerBridge } from "../hooks/useIncisionControllerBridge";
import { incisionLegacyController } from "../services/legacyControllers";

export function IncisionRoute() {
  useIncisionControllerBridge();

  return (
    <ManagedWorkbenchRoute
      controller={incisionLegacyController}
      failedStatus="切口工作台加载失败"
      loadingStatus="加载切口工作台"
      mountedStatus="切口工作台已挂载"
      unloadedStatus="切口工作台已卸载"
      workspace="incision"
    >
      <IncisionWorkbench />
    </ManagedWorkbenchRoute>
  );
}
