import { useVersionedControllerSnapshotBridge } from "./useControllerSnapshotBridge";
import {
  INCISION_CONTROLLER_STATE_EVENT,
  type IncisionControllerSnapshot,
  useIncisionStore,
} from "../stores/incisionStore";
import { INCISION_SNAPSHOT_SCHEMA_VERSION } from "../lib/controllerSnapshotSchemas";

export function useIncisionControllerBridge() {
  const setControllerSnapshot = useIncisionStore((state) => state.setControllerSnapshot);
  const clearControllerSnapshot = useIncisionStore((state) => state.clearControllerSnapshot);

  useVersionedControllerSnapshotBridge<IncisionControllerSnapshot>({
    eventName: INCISION_CONTROLLER_STATE_EVENT,
    schemaVersion: INCISION_SNAPSHOT_SCHEMA_VERSION,
    setSnapshot: setControllerSnapshot,
    clearSnapshot: clearControllerSnapshot,
  });
}
