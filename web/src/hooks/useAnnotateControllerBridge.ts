import { useControllerSnapshotBridge } from "./useControllerSnapshotBridge";
import {
  ANNOTATE_CONTROLLER_STATE_EVENT,
  type AnnotateControllerSnapshot,
  useAnnotateStore,
} from "../stores/annotateStore";

function isControllerSnapshot(value: unknown): value is AnnotateControllerSnapshot {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { schema_version?: string }).schema_version === "react-annotate-controller-snapshot/v0.1",
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
