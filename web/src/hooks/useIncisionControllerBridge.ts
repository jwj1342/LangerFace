import { useEffect } from "react";

import {
  INCISION_CONTROLLER_STATE_EVENT,
  type IncisionControllerSnapshot,
  useIncisionStore,
} from "../stores/incisionStore";

function isControllerSnapshot(value: unknown): value is IncisionControllerSnapshot {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { schema_version?: string }).schema_version === "react-incision-controller-snapshot/v0.1",
  );
}

export function useIncisionControllerBridge() {
  const setControllerSnapshot = useIncisionStore((state) => state.setControllerSnapshot);
  const clearControllerSnapshot = useIncisionStore((state) => state.clearControllerSnapshot);

  useEffect(() => {
    function handleStateEvent(event: Event) {
      const detail = (event as CustomEvent<unknown>).detail;
      if (isControllerSnapshot(detail)) setControllerSnapshot(detail);
    }

    window.addEventListener(INCISION_CONTROLLER_STATE_EVENT, handleStateEvent);
    return () => {
      window.removeEventListener(INCISION_CONTROLLER_STATE_EVENT, handleStateEvent);
      clearControllerSnapshot();
    };
  }, [clearControllerSnapshot, setControllerSnapshot]);
}
