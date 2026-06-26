import { useRef } from "react";

import { AnnotateWorkbench } from "./AnnotateWorkbench";
import { ReactRouteHost } from "../components/ReactShell";
import { useAnnotateControllerBridge } from "../hooks/useAnnotateControllerBridge";
import { useManagedWorkbenchController } from "../hooks/useManagedWorkbenchController";

type AnnotateControllerModule = typeof import("../../annotate_main.js");

const loadAnnotateController = () => import("../../annotate_main.js");
const mountAnnotateController = (module: AnnotateControllerModule, root: HTMLElement) => module.mountAnnotateWorkbench(root);
const disposeAnnotateController = (module: AnnotateControllerModule) => module.disposeAnnotateWorkbench?.();

export function AnnotateRoute() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useAnnotateControllerBridge();

  useManagedWorkbenchController({
    hostRef,
    workspace: "annotate",
    loadingStatus: "加载 3D 标注",
    mountedStatus: "3D 标注已挂载",
    failedStatus: "3D 标注加载失败",
    unloadedStatus: "3D 标注已卸载",
    loadModule: loadAnnotateController,
    mount: mountAnnotateController,
    dispose: disposeAnnotateController,
  });

  return (
    <ReactRouteHost ref={hostRef} workspace="annotate">
      <AnnotateWorkbench />
    </ReactRouteHost>
  );
}
