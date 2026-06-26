import { useControllerSnapshotBridge } from "./useControllerSnapshotBridge";
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

  useControllerSnapshotBridge({
    eventName: INCISION_CONTROLLER_STATE_EVENT,
    isSnapshot: isControllerSnapshot,
    setSnapshot: setControllerSnapshot,
    clearSnapshot: clearControllerSnapshot,
  });
}
