import { useRef, type ReactNode } from "react";

import { useManagedWorkbenchController } from "../hooks/useManagedWorkbenchController";
import type { Workspace } from "../stores/appStore";
import { ReactRouteHost } from "./ReactShell";

type ManagedWorkbenchWorkspace = Extract<Workspace, "annotate" | "incision" | "live">;

export interface ManagedWorkbenchControllerAdapter<TModule> {
  dispose?: (module: TModule) => void;
  loadModule: () => Promise<TModule>;
  mount: (module: TModule, root: HTMLElement) => () => void;
}

interface ManagedWorkbenchRouteProps<TModule> {
  children: ReactNode;
  controller: ManagedWorkbenchControllerAdapter<TModule>;
  failedStatus: string;
  legacyNotice?: string;
  loadingStatus: string;
  mountedStatus: string;
  unloadedStatus: string;
  workspace: ManagedWorkbenchWorkspace;
}

export function ManagedWorkbenchRoute<TModule>({
  children,
  controller,
  failedStatus,
  legacyNotice,
  loadingStatus,
  mountedStatus,
  unloadedStatus,
  workspace,
}: ManagedWorkbenchRouteProps<TModule>) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useManagedWorkbenchController({
    dispose: controller.dispose,
    failedStatus,
    hostRef,
    loadingStatus,
    loadModule: controller.loadModule,
    mount: controller.mount,
    mountedStatus,
    unloadedStatus,
    workspace,
  });

  return (
    <ReactRouteHost ref={hostRef} workspace={workspace}>
      {legacyNotice ? <div className="react-legacy-banner">{legacyNotice}</div> : null}
      {children}
    </ReactRouteHost>
  );
}
