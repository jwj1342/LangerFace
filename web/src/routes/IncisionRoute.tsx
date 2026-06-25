import { useEffect, useRef } from "react";

import { useAppStore } from "../stores/appStore";

function extractWorkbenchHtml(text: string) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  doc.querySelectorAll("script").forEach((node) => node.remove());
  const styles = [...doc.querySelectorAll("style")].map((node) => node.textContent || "").join("\n");
  return {
    styles,
    body: doc.body.innerHTML,
  };
}

export function IncisionRoute() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const setActiveWorkspace = useAppStore((state) => state.setActiveWorkspace);
  const setRouteStatus = useAppStore((state) => state.setRouteStatus);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    async function mountLegacyWorkbench() {
      setActiveWorkspace("incision");
      setRouteStatus("加载切口工作台");
      const response = await fetch("/incision_agent.html", { cache: "no-store" });
      if (!response.ok) throw new Error(`切口工作台 HTML 加载失败：HTTP ${response.status}`);
      const { styles, body } = extractWorkbenchHtml(await response.text());
      if (disposed || !hostRef.current) return;

      hostRef.current.innerHTML = `<style>${styles}</style>${body}`;
      window.__LANGERFACE_REACT_MANAGED__ = true;
      const module = await import("../../incision_agent_main.js");
      if (disposed || !hostRef.current) {
        module.disposeIncisionAgentWorkbench?.();
        return;
      }
      cleanup = module.mountIncisionAgentWorkbench(hostRef.current);
      setRouteStatus("切口工作台已挂载");
    }

    mountLegacyWorkbench().catch((err) => {
      setRouteStatus("切口工作台加载失败");
      if (hostRef.current) {
        hostRef.current.innerHTML = `<div class="react-page grid place-items-center p-6"><div class="card max-w-[520px]"><div class="quality-top"><span>加载失败</span><span>error</span></div><p class="hint">${err.message}</p></div></div>`;
      }
      console.error(err);
    });

    return () => {
      disposed = true;
      cleanup?.();
      if (hostRef.current) hostRef.current.innerHTML = "";
      setRouteStatus("切口工作台已卸载");
    };
  }, [setActiveWorkspace, setRouteStatus]);

  return <div ref={hostRef} className="react-legacy-host" />;
}
