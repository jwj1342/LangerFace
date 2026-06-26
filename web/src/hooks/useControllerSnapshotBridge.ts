import { useEffect } from "react";

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

    window.addEventListener(eventName, handleStateEvent);
    return () => {
      window.removeEventListener(eventName, handleStateEvent);
      clearSnapshot();
    };
  }, [clearSnapshot, eventName, isSnapshot, setSnapshot]);
}
