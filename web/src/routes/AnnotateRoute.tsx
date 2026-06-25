import { useEffect, useRef } from "react";

import { AnnotateWorkbench } from "./AnnotateWorkbench";
import { useAppStore } from "../stores/appStore";

export function AnnotateRoute() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const setActiveWorkspace = useAppStore((state) => state.setActiveWorkspace);
  const setRouteStatus = useAppStore((state) => state.setRouteStatus);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    async function mountAnnotateController() {
      setActiveWorkspace("annotate");
      setRouteStatus("加载 3D 标注");
      if (disposed || !hostRef.current) return;

      window.__LANGERFACE_REACT_MANAGED__ = true;
      const module = await import("../../annotate_main.js");
      if (disposed || !hostRef.current) {
        module.disposeAnnotateWorkbench?.();
        return;
      }
      cleanup = module.mountAnnotateWorkbench(hostRef.current);
      setRouteStatus("3D 标注已挂载");
    }

    mountAnnotateController().catch((err) => {
      setRouteStatus("3D 标注加载失败");
      console.error(err);
    });

    return () => {
      disposed = true;
      cleanup?.();
      setRouteStatus("3D 标注已卸载");
    };
  }, [setActiveWorkspace, setRouteStatus]);

  return (
    <div ref={hostRef} className="react-annotate-host">
      <AnnotateWorkbench />
    </div>
  );
}
