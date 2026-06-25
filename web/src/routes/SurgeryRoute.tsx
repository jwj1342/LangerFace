import { useEffect, useRef } from "react";

import { SurgeryWorkbench } from "./SurgeryWorkbench";
import { useAppStore } from "../stores/appStore";

export function SurgeryRoute() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const setActiveWorkspace = useAppStore((state) => state.setActiveWorkspace);
  const setRouteStatus = useAppStore((state) => state.setRouteStatus);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    async function mountSurgeryController() {
      setActiveWorkspace("surgery");
      setRouteStatus("加载闭合演示");
      if (disposed || !hostRef.current) return;

      window.__LANGERFACE_REACT_MANAGED__ = true;
      const module = await import("../../surgery_main.js");
      if (disposed || !hostRef.current) {
        module.disposeSurgeryClosureDemo?.();
        return;
      }
      cleanup = module.mountSurgeryClosureDemo(hostRef.current);
      setRouteStatus("闭合演示已挂载");
    }

    mountSurgeryController().catch((err) => {
      setRouteStatus("闭合演示加载失败");
      console.error(err);
    });

    return () => {
      disposed = true;
      cleanup?.();
      setRouteStatus("闭合演示已卸载");
    };
  }, [setActiveWorkspace, setRouteStatus]);

  return (
    <div ref={hostRef} className="react-surgery-host">
      <SurgeryWorkbench />
    </div>
  );
}
