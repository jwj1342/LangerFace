import { useEffect } from "react";

import { bindWindowControllerEvents } from "../lib/controllerCommand";

interface ControllerSnapshotBridgeOptions<TSnapshot> {
  eventName: string;
  isSnapshot: (value: unknown) => value is TSnapshot;
  setSnapshot: (snapshot: TSnapshot) => void;
  clearSnapshot: () => void;
}

export function useControllerSnapshotBridge<TSnapshot>({
  eventName,
  isSnapshot,
  setSnapshot,
  clearSnapshot,
}: ControllerSnapshotBridgeOptions<TSnapshot>) {
  useEffect(() => {
    function handleStateEvent(event: Event) {
      const detail = (event as CustomEvent<unknown>).detail;
      if (isSnapshot(detail)) setSnapshot(detail);
    }

    const cleanup = bindWindowControllerEvents([[eventName, handleStateEvent]]);
    return () => {
      cleanup();
      clearSnapshot();
    };
  }, [clearSnapshot, eventName, isSnapshot, setSnapshot]);
}
