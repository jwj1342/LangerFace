import type { ManagedWorkbenchControllerAdapter } from "../components/ManagedWorkbenchRoute";

export type AnnotateControllerModule = typeof import("./annotateRuntime");
export type IncisionControllerModule = typeof import("./incisionRuntime");
export type LiveControllerModule = typeof import("./liveRuntime");

export const annotateLegacyController: ManagedWorkbenchControllerAdapter<AnnotateControllerModule> = {
  loadModule: () => import("./annotateRuntime"),
  mount: (module, root) => module.mountAnnotateWorkbench(root),
  dispose: (module) => module.disposeAnnotateWorkbench?.(),
};

export const incisionLegacyController: ManagedWorkbenchControllerAdapter<IncisionControllerModule> = {
  loadModule: () => import("./incisionRuntime"),
  mount: (module, root) => module.mountIncisionWorkbench(root),
  dispose: (module) => module.disposeIncisionWorkbench?.(),
};

export const liveLegacyController: ManagedWorkbenchControllerAdapter<LiveControllerModule> = {
  loadModule: () => import("./liveRuntime"),
  mount: (module, root) => module.mountLiveWorkbench(root),
  dispose: (module) => module.disposeLiveWorkbench?.(),
};
