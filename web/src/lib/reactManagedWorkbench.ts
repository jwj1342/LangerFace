export const REACT_MANAGED_WORKBENCH_FLAG = "__LANGERFACE_REACT_MANAGED__";

export type ReactManagedWorkbenchSnapshot = boolean | undefined;

export function isReactManagedWorkbench(): boolean {
  return typeof window !== "undefined" && window[REACT_MANAGED_WORKBENCH_FLAG] === true;
}

export function captureReactManagedWorkbench(): ReactManagedWorkbenchSnapshot {
  if (typeof window === "undefined") return undefined;
  return window[REACT_MANAGED_WORKBENCH_FLAG];
}

export function enableReactManagedWorkbench(): void {
  if (typeof window === "undefined") return;
  window[REACT_MANAGED_WORKBENCH_FLAG] = true;
}

export function restoreReactManagedWorkbench(snapshot: ReactManagedWorkbenchSnapshot): void {
  if (typeof window === "undefined") return;
  if (snapshot === undefined) delete window[REACT_MANAGED_WORKBENCH_FLAG];
  else window[REACT_MANAGED_WORKBENCH_FLAG] = snapshot;
}
