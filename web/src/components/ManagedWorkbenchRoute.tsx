import { useRef, type ReactNode } from "react";

import { useManagedWorkbenchController } from "../hooks/useManagedWorkbenchController";
import type { Workspace } from "../stores/appStore";
import { ReactRouteHost } from "./ReactShell";

type ManagedWorkbenchWorkspace = Extract<Workspace, "annotate" | "incision" | "live">;

interface ManagedWorkbenchRouteProps<TModule> {
  children: ReactNode;
  failedStatus: string;
  legacyNotice?: string;
  loadModule: () => Promise<TModule>;
  loadingStatus: string;
  mount: (module: TModule, root: HTMLElement) => () => void;
  mountedStatus: string;
  unloadedStatus: string;
  workspace: ManagedWorkbenchWorkspace;
}

export function ManagedWorkbenchRoute<TModule>({
  children,
  failedStatus,
  legacyNotice,
  loadModule,
  loadingStatus,
  mount,
  mountedStatus,
  unloadedStatus,
  workspace,
}: ManagedWorkbenchRouteProps<TModule>) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useManagedWorkbenchController({
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
      {legacyNotice ? <div className="react-legacy-banner">{legacyNotice}</div> : null}
      {children}
    </ReactRouteHost>
  );
}
