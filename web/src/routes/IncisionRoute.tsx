import { useEffect, useRef } from "react";

import { IncisionWorkbench } from "./IncisionWorkbench";
import { useIncisionControllerBridge } from "../hooks/useIncisionControllerBridge";
import { useAppStore } from "../stores/appStore";

export function IncisionRoute() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const setActiveWorkspace = useAppStore((state) => state.setActiveWorkspace);
  const setRouteStatus = useAppStore((state) => state.setRouteStatus);
  useIncisionControllerBridge();

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    async function mountWorkbenchController() {
      setActiveWorkspace("incision");
      setRouteStatus("加载切口工作台");
      if (disposed || !hostRef.current) return;

      window.__LANGERFACE_REACT_MANAGED__ = true;
      const module = await import("../../incision_agent_main.js");
      if (disposed || !hostRef.current) {
        module.disposeIncisionAgentWorkbench?.();
        return;
      }
      cleanup = module.mountIncisionAgentWorkbench(hostRef.current);
      setRouteStatus("切口工作台已挂载");
    }

    mountWorkbenchController().catch((err) => {
      setRouteStatus("切口工作台加载失败");
      console.error(err);
    });

    return () => {
      disposed = true;
      cleanup?.();
      setRouteStatus("切口工作台已卸载");
    };
  }, [setActiveWorkspace, setRouteStatus]);

  return (
    <div ref={hostRef} className="react-incision-host">
      <IncisionWorkbench />
    </div>
  );
}
