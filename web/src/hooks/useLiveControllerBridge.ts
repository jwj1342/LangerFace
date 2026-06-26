import { useControllerSnapshotBridge } from "./useControllerSnapshotBridge";
import {
  LIVE_CONTROLLER_STATE_EVENT,
  type LiveControllerSnapshot,
  useLiveStore,
} from "../stores/liveStore";

function isControllerSnapshot(value: unknown): value is LiveControllerSnapshot {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { schema_version?: string }).schema_version === "react-live-controller-snapshot/v0.1",
  );
}

export function useLiveControllerBridge() {
  const setControllerSnapshot = useLiveStore((state) => state.setControllerSnapshot);
  const clearControllerSnapshot = useLiveStore((state) => state.clearControllerSnapshot);

  useControllerSnapshotBridge({
    eventName: LIVE_CONTROLLER_STATE_EVENT,
    isSnapshot: isControllerSnapshot,
    setSnapshot: setControllerSnapshot,
    clearSnapshot: clearControllerSnapshot,
  });
}
