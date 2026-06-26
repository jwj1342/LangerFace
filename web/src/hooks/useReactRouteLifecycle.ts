import { useEffect } from "react";

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
    const previousManagedFlag = window.__LANGERFACE_REACT_MANAGED__;
    setActiveWorkspace(workspace);
    if (reactManaged) window.__LANGERFACE_REACT_MANAGED__ = true;
    setRouteStatus(mountedStatus);

    return () => {
      if (reactManaged) {
        if (previousManagedFlag === undefined) delete window.__LANGERFACE_REACT_MANAGED__;
        else window.__LANGERFACE_REACT_MANAGED__ = previousManagedFlag;
      }
      setRouteStatus(unloadedStatus);
    };
  }, [mountedStatus, reactManaged, setActiveWorkspace, setRouteStatus, unloadedStatus, workspace]);
}
