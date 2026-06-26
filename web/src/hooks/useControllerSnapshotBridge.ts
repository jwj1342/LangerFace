import { useEffect } from "react";

import { bindWindowControllerEvents } from "../lib/controllerCommand";

interface ControllerSnapshotBridgeOptions<TSnapshot> {
  eventName: string;
  isSnapshot: (value: unknown) => value is TSnapshot;
  setSnapshot: (snapshot: TSnapshot) => void;
  clearSnapshot: () => void;
}

interface VersionedControllerSnapshot {
  schema_version: string;
}

interface VersionedControllerSnapshotBridgeOptions<TSnapshot extends VersionedControllerSnapshot> {
  eventName: string;
  schemaVersion: TSnapshot["schema_version"];
  setSnapshot: (snapshot: TSnapshot) => void;
  clearSnapshot: () => void;
}

export function hasControllerSnapshotSchema<TSnapshot extends VersionedControllerSnapshot>(
  value: unknown,
  schemaVersion: TSnapshot["schema_version"],
): value is TSnapshot {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Partial<VersionedControllerSnapshot>).schema_version === schemaVersion,
  );
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

export function useVersionedControllerSnapshotBridge<TSnapshot extends VersionedControllerSnapshot>({
  eventName,
  schemaVersion,
  setSnapshot,
  clearSnapshot,
}: VersionedControllerSnapshotBridgeOptions<TSnapshot>) {
  useControllerSnapshotBridge({
    eventName,
    isSnapshot: (value): value is TSnapshot => hasControllerSnapshotSchema<TSnapshot>(value, schemaVersion),
    setSnapshot,
    clearSnapshot,
  });
}
