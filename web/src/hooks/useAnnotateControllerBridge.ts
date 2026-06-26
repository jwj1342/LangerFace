import { useVersionedControllerSnapshotBridge } from "./useControllerSnapshotBridge";
import {
  ANNOTATE_CONTROLLER_STATE_EVENT,
  type AnnotateControllerSnapshot,
  useAnnotateStore,
} from "../stores/annotateStore";
import { ANNOTATE_SNAPSHOT_SCHEMA_VERSION } from "../lib/controllerSnapshotSchemas";

export function useAnnotateControllerBridge() {
  const setControllerSnapshot = useAnnotateStore((state) => state.setControllerSnapshot);
  const clearControllerSnapshot = useAnnotateStore((state) => state.clearControllerSnapshot);

  useVersionedControllerSnapshotBridge<AnnotateControllerSnapshot>({
    eventName: ANNOTATE_CONTROLLER_STATE_EVENT,
    schemaVersion: ANNOTATE_SNAPSHOT_SCHEMA_VERSION,
    setSnapshot: setControllerSnapshot,
    clearSnapshot: clearControllerSnapshot,
  });
}
