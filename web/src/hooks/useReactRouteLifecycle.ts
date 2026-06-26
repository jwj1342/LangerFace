import { useEffect } from "react";

import {
  captureReactManagedWorkbench,
  enableReactManagedWorkbench,
  restoreReactManagedWorkbench,
} from "../lib/reactManagedWorkbench";
import { type Workspace, useAppStore } from "../stores/appStore";

interface ReactRouteLifecycleOptions {
  workspace: Workspace;
  mountedStatus: string;
  unloadedStatus: string;
  reactManaged?: boolean;
}

export function useReactRouteLifecycle({
  workspace,
  mountedStatus,
  unloadedStatus,
  reactManaged = false,
}: ReactRouteLifecycleOptions) {
  const setActiveWorkspace = useAppStore((state) => state.setActiveWorkspace);
  const setRouteStatus = useAppStore((state) => state.setRouteStatus);

  useEffect(() => {
    const previousManagedFlag = captureReactManagedWorkbench();
    setActiveWorkspace(workspace);
    if (reactManaged) enableReactManagedWorkbench();
    setRouteStatus(mountedStatus);

    return () => {
      if (reactManaged) restoreReactManagedWorkbench(previousManagedFlag);
      setRouteStatus(unloadedStatus);
    };
  }, [mountedStatus, reactManaged, setActiveWorkspace, setRouteStatus, unloadedStatus, workspace]);
}
