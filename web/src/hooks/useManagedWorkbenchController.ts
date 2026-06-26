import { type RefObject, useEffect } from "react";

import {
  captureReactManagedWorkbench,
  enableReactManagedWorkbench,
  restoreReactManagedWorkbench,
} from "../lib/reactManagedWorkbench";
import { type Workspace, useAppStore } from "../stores/appStore";

interface ManagedWorkbenchControllerOptions<TModule> {
  hostRef: RefObject<HTMLElement | null>;
  workspace: Workspace;
  loadingStatus: string;
  mountedStatus: string;
  failedStatus: string;
  unloadedStatus: string;
  loadModule: () => Promise<TModule>;
  mount: (module: TModule, root: HTMLElement) => () => void;
  dispose?: (module: TModule) => void;
}

export function useManagedWorkbenchController<TModule>({
  hostRef,
  workspace,
  loadingStatus,
  mountedStatus,
  failedStatus,
  unloadedStatus,
  loadModule,
  mount,
  dispose,
}: ManagedWorkbenchControllerOptions<TModule>) {
  const setActiveWorkspace = useAppStore((state) => state.setActiveWorkspace);
  const setRouteStatus = useAppStore((state) => state.setRouteStatus);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    const previousManagedFlag = captureReactManagedWorkbench();

    async function mountController() {
      setActiveWorkspace(workspace);
      setRouteStatus(loadingStatus);
      if (disposed || !hostRef.current) return;

      enableReactManagedWorkbench();
      const module = await loadModule();
      if (disposed || !hostRef.current) {
        dispose?.(module);
        return;
      }
      cleanup = mount(module, hostRef.current);
      setRouteStatus(mountedStatus);
    }

    mountController().catch((err) => {
      if (disposed) return;
      setRouteStatus(failedStatus);
      console.error(err);
    });

    return () => {
      disposed = true;
      cleanup?.();
      restoreReactManagedWorkbench(previousManagedFlag);
      setRouteStatus(unloadedStatus);
    };
  }, [
    dispose,
    failedStatus,
    hostRef,
    loadModule,
    loadingStatus,
    mount,
    mountedStatus,
    setActiveWorkspace,
    setRouteStatus,
    unloadedStatus,
    workspace,
  ]);
}
