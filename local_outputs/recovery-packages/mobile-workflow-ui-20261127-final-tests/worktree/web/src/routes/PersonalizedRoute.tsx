import { useEffect } from "react";

import { PersonalizedWorkbench } from "./PersonalizedWorkbench";
import "../personalized.css";

export function PersonalizedRoute() {
  useEffect(() => {
    let runtime: typeof import("../services/personalized/personalizedRuntime") | null = null;
    let cancelled = false;

    void import("../services/personalized/personalizedRuntime").then((module) => {
      if (cancelled) module.disposePersonalizedWorkbench();
      else {
        runtime = module;
        module.mountPersonalizedWorkbench();
      }
    });

    return () => {
      cancelled = true;
      runtime?.disposePersonalizedWorkbench();
    };
  }, []);

  return <PersonalizedWorkbench />;
}
