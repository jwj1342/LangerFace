import { useControllerSnapshotBridge } from "./useControllerSnapshotBridge";
import {
  ANNOTATE_CONTROLLER_STATE_EVENT,
  type AnnotateControllerSnapshot,
  useAnnotateStore,
} from "../stores/annotateStore";
import { ANNOTATE_SNAPSHOT_SCHEMA_VERSION } from "../lib/controllerSnapshotSchemas";

function isControllerSnapshot(value: unknown): value is AnnotateControllerSnapshot {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { schema_version?: string }).schema_version === ANNOTATE_SNAPSHOT_SCHEMA_VERSION,
  );
}

export function useAnnotateControllerBridge() {
  const setControllerSnapshot = useAnnotateStore((state) => state.setControllerSnapshot);
  const clearControllerSnapshot = useAnnotateStore((state) => state.clearControllerSnapshot);

  useControllerSnapshotBridge({
    eventName: ANNOTATE_CONTROLLER_STATE_EVENT,
    isSnapshot: isControllerSnapshot,
    setSnapshot: setControllerSnapshot,
    clearSnapshot: clearControllerSnapshot,
  });
}
