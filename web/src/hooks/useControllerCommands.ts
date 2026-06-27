import { useCallback, useMemo } from "react";

import {
  type AnnotateDrawCommand,
  type AnnotateLibraryCommand,
  type AnnotateMeshCommand,
  type IncisionEditCommand,
  type IncisionLibraryCommand,
  type IncisionReviewCommand,
  type IncisionSecondaryCueCommand,
  type IncisionTumorCommand,
  type LiveRenderCommand,
  type LiveRouteCommand,
  type LiveSourceCommand,
  dispatchAnnotateDrawCommand,
  dispatchAnnotateLibraryCommand,
  dispatchAnnotateMeshCommand,
  dispatchIncisionEditCommand,
  dispatchIncisionLibraryCommand,
  dispatchIncisionProviderState,
  dispatchIncisionReviewCommand,
  dispatchIncisionSecondaryCueCommand,
  dispatchIncisionTumorCommand,
  dispatchLiveRenderCommand,
  dispatchLiveRouteCommand,
  dispatchLiveSourceCommand,
} from "../lib/controllerCommand";

export function useLiveControllerCommands() {
  const source = useCallback((command: LiveSourceCommand) => {
    dispatchLiveSourceCommand(command);
  }, []);
  const render = useCallback((command: LiveRenderCommand, value?: string | number | boolean) => {
    dispatchLiveRenderCommand(command, value);
  }, []);
  const route = useCallback((command: LiveRouteCommand, value?: string | boolean) => {
    dispatchLiveRouteCommand(command, value);
  }, []);

  return useMemo(() => ({ render, route, source }), [render, route, source]);
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
  const tumor = useCallback((command: IncisionTumorCommand) => {
    dispatchIncisionTumorCommand(command);
  }, []);
  const providerState = useCallback((source?: string) => {
    dispatchIncisionProviderState(source);
  }, []);
  const secondaryCue = useCallback((command: IncisionSecondaryCueCommand) => {
    dispatchIncisionSecondaryCueCommand(command);
  }, []);
  const edit = useCallback((command: IncisionEditCommand) => {
    dispatchIncisionEditCommand(command);
  }, []);
  const review = useCallback((command: IncisionReviewCommand) => {
    dispatchIncisionReviewCommand(command);
  }, []);
  const library = useCallback((command: IncisionLibraryCommand, id?: string) => {
    dispatchIncisionLibraryCommand(command, id);
  }, []);

  return useMemo(
    () => ({ edit, library, providerState, review, secondaryCue, tumor }),
    [edit, library, providerState, review, secondaryCue, tumor],
  );
}
