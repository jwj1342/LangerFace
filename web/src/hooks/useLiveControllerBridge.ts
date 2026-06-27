import { useVersionedControllerSnapshotBridge } from "./useControllerSnapshotBridge";
import {
  LIVE_CONTROLLER_STATE_EVENT,
  type LiveControllerSnapshot,
  useLiveStore,
} from "../stores/liveStore";
import { LIVE_SNAPSHOT_SCHEMA_VERSION } from "../lib/controllerSnapshotSchemas";

export function useLiveControllerBridge() {
  const setControllerSnapshot = useLiveStore((state) => state.setControllerSnapshot);
  const clearControllerSnapshot = useLiveStore((state) => state.clearControllerSnapshot);

  useVersionedControllerSnapshotBridge<LiveControllerSnapshot>({
    eventName: LIVE_CONTROLLER_STATE_EVENT,
    schemaVersion: LIVE_SNAPSHOT_SCHEMA_VERSION,
    setSnapshot: setControllerSnapshot,
    clearSnapshot: clearControllerSnapshot,
  });
}
