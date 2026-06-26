import { useRef, type ReactNode } from "react";

import { useManagedWorkbenchController } from "../hooks/useManagedWorkbenchController";
import type { Workspace } from "../stores/appStore";
import { ReactRouteHost } from "./ReactShell";

type ManagedWorkbenchWorkspace = Extract<Workspace, "annotate" | "incision" | "live">;

interface ManagedWorkbenchRouteProps<TModule> {
  children: ReactNode;
  dispose?: (module: TModule) => void;
  failedStatus: string;
  loadingStatus: string;
  loadModule: () => Promise<TModule>;
  mount: (module: TModule, root: HTMLElement) => () => void;
  mountedStatus: string;
  unloadedStatus: string;
  workspace: ManagedWorkbenchWorkspace;
}

export function ManagedWorkbenchRoute<TModule>({
  children,
  dispose,
  failedStatus,
  loadingStatus,
  loadModule,
  mount,
  mountedStatus,
  unloadedStatus,
  workspace,
}: ManagedWorkbenchRouteProps<TModule>) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useManagedWorkbenchController({
    dispose,
    failedStatus,
    hostRef,
    loadingStatus,
    loadModule,
    mount,
    mountedStatus,
    unloadedStatus,
    workspace,
  });

  return (
    <ReactRouteHost ref={hostRef} workspace={workspace}>
      {children}
    </ReactRouteHost>
  );
}
