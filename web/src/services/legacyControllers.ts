import type { ManagedWorkbenchControllerAdapter } from "../components/ManagedWorkbenchRoute";

export type AnnotateControllerModule = typeof import("./annotateRuntime");
export type IncisionControllerModule = typeof import("../../incision_agent_main.js");
export type LiveControllerModule = typeof import("../../main.js");

export const annotateLegacyController: ManagedWorkbenchControllerAdapter<AnnotateControllerModule> = {
  loadModule: () => import("./annotateRuntime"),
  mount: (module, root) => module.mountAnnotateWorkbench(root),
  dispose: (module) => module.disposeAnnotateWorkbench?.(),
};

export const incisionLegacyController: ManagedWorkbenchControllerAdapter<IncisionControllerModule> = {
  loadModule: () => import("../../incision_agent_main.js"),
  mount: (module, root) => module.mountIncisionAgentWorkbench(root),
  dispose: (module) => module.disposeIncisionAgentWorkbench?.(),
};

export const liveLegacyController: ManagedWorkbenchControllerAdapter<LiveControllerModule> = {
  loadModule: () => import("../../main.js"),
  mount: (module, root) => module.mountLiveWorkbench(root),
  dispose: (module) => module.disposeLiveWorkbench?.(),
};
