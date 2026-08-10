import { useCallback, useMemo } from "react";

import {
  type AnnotateDrawCommand,
  type AnnotateLibraryCommand,
  type AnnotateMeshCommand,
  type IncisionEditControlId,
  type IncisionEditCommand,
  type IncisionLibraryCommand,
  type IncisionReviewCommand,
  type IncisionSecondaryCueCommand,
  type IncisionTumorCommand,
  type LiveRenderCommand,
  type LiveSourceCommand,
  dispatchAnnotateDrawCommand,
  dispatchAnnotateLibraryCommand,
  dispatchAnnotateMeshCommand,
  dispatchIncisionEditCommand,
  dispatchIncisionLibraryCommand,
  dispatchIncisionReviewCommand,
  dispatchIncisionSecondaryCueCommand,
  dispatchIncisionTumorCommand,
  dispatchLiveRenderCommand,
  dispatchLiveSourceCommand,
} from "../lib/controllerCommand";

export function useLiveControllerCommands() {
  const source = useCallback((command: LiveSourceCommand) => {
    dispatchLiveSourceCommand(command);
  }, []);
  const render = useCallback((command: LiveRenderCommand, value?: string | number | boolean) => {
    dispatchLiveRenderCommand(command, value);
  }, []);
  return useMemo(() => ({ render, source }), [render, source]);
}

export function useAnnotateControllerCommands() {
  const mesh = useCallback((command: AnnotateMeshCommand) => {
    dispatchAnnotateMeshCommand(command);
  }, []);
  const draw = useCallback((command: AnnotateDrawCommand, value?: string) => {
    dispatchAnnotateDrawCommand(command, value);
  }, []);
  const library = useCallback((command: AnnotateLibraryCommand, index?: number) => {
    dispatchAnnotateLibraryCommand(command, index);
  }, []);

  return useMemo(() => ({ draw, library, mesh }), [draw, library, mesh]);
}

export function useIncisionControllerCommands() {
  const tumor = useCallback((command: IncisionTumorCommand, value?: string | number) => {
    dispatchIncisionTumorCommand(command, value);
  }, []);
  const secondaryCue = useCallback((command: IncisionSecondaryCueCommand) => {
    dispatchIncisionSecondaryCueCommand(command);
  }, []);
  const edit = useCallback((command: IncisionEditCommand, controlId?: IncisionEditControlId, value?: string) => {
    dispatchIncisionEditCommand(command, controlId, value);
  }, []);
  const review = useCallback((command: IncisionReviewCommand) => {
    dispatchIncisionReviewCommand(command);
  }, []);
  const library = useCallback((command: IncisionLibraryCommand, id?: string) => {
    dispatchIncisionLibraryCommand(command, id);
  }, []);

  return useMemo(
    () => ({ edit, library, review, secondaryCue, tumor }),
    [edit, library, review, secondaryCue, tumor],
  );
}
