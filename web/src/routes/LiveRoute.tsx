import { useEffect, useRef } from "react";

import { LiveWorkbench } from "./LiveWorkbench";
import { useLiveControllerBridge } from "../hooks/useLiveControllerBridge";
import { useAppStore } from "../stores/appStore";

export function LiveRoute() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const setActiveWorkspace = useAppStore((state) => state.setActiveWorkspace);
  const setRouteStatus = useAppStore((state) => state.setRouteStatus);
  useLiveControllerBridge();

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    async function mountLiveController() {
      setActiveWorkspace("live");
      setRouteStatus("加载实时显示");
      if (disposed || !hostRef.current) return;

      window.__LANGERFACE_REACT_MANAGED__ = true;
      const module = await import("../../main.js");
      if (disposed || !hostRef.current) {
        module.disposeLiveWorkbench?.();
        return;
      }
      cleanup = module.mountLiveWorkbench(hostRef.current);
      setRouteStatus("实时显示已挂载");
    }

    mountLiveController().catch((err) => {
      setRouteStatus("实时显示加载失败");
      console.error(err);
    });

    return () => {
      disposed = true;
      cleanup?.();
      setRouteStatus("实时显示已卸载");
    };
  }, [setActiveWorkspace, setRouteStatus]);

  return (
    <div ref={hostRef} className="react-live-host">
      <LiveWorkbench />
    </div>
  );
}
