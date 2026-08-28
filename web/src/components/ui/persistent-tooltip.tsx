import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";

interface TooltipPosition {
  left: number;
  top: number;
  maxWidth: number;
}

const TOOLTIP_RELEASE_DISMISS_MS = 2_000;

export function usePersistentTooltip<T extends HTMLElement>(active: boolean) {
  const anchorRef = useRef<T>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerFocusRef = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [activated, setActivated] = useState(false);
  const [interactionSuppressed, setInteractionSuppressed] = useState(false);
  const open = active && (activated || (!interactionSuppressed && (hovered || focused)));

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current === null) return;
    clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = null;
  }, []);

  const dismiss = useCallback(() => {
    clearDismissTimer();
    setActivated(false);
    setInteractionSuppressed(true);
  }, [clearDismissTimer]);

  const showForRelease = useCallback(() => {
    if (!active) return;
    clearDismissTimer();
    setActivated(true);
    setInteractionSuppressed(false);
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      setActivated(false);
      setInteractionSuppressed(true);
    }, TOOLTIP_RELEASE_DISMISS_MS);
  }, [active, clearDismissTimer]);

  useEffect(() => {
    if (!active) {
      clearDismissTimer();
      setHovered(false);
      setFocused(false);
      setActivated(false);
      setInteractionSuppressed(false);
      pointerFocusRef.current = false;
    }
  }, [active, clearDismissTimer]);

  useEffect(() => () => clearDismissTimer(), [clearDismissTimer]);

  useEffect(() => {
    if (!open) return undefined;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && anchorRef.current?.contains(target)) return;
      dismiss();
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, [dismiss, open]);

  return {
    anchorRef,
    open,
    onPointerEnter: useCallback(() => {
      setInteractionSuppressed(false);
      setHovered(true);
    }, []),
    onPointerLeave: useCallback(() => setHovered(false), []),
    onFocus: useCallback(() => {
      if (pointerFocusRef.current) return;
      setInteractionSuppressed(false);
      setFocused(true);
    }, []),
    onBlur: useCallback(() => {
      pointerFocusRef.current = false;
      setFocused(false);
    }, []),
    onPointerDown: useCallback(() => {
      if (!active) return;
      pointerFocusRef.current = true;
      clearDismissTimer();
      setFocused(false);
      setActivated(true);
      setInteractionSuppressed(false);
    }, [active, clearDismissTimer]),
    showForRelease: useCallback(() => {
      showForRelease();
      pointerFocusRef.current = false;
    }, [showForRelease]),
  };
}

export function PersistentTooltip<T extends HTMLElement>({
  anchorRef,
  id,
  message,
  open,
}: {
  anchorRef: RefObject<T | null>;
  id: string;
  message: string;
  open: boolean;
}) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) return;
    const viewportMargin = 12;
    const gap = 8;
    const maxWidth = Math.max(240, Math.min(560, window.innerWidth - viewportMargin * 2));
    tooltip.style.maxWidth = `${maxWidth}px`;
    const anchorBox = anchor.getBoundingClientRect();
    const tooltipBox = tooltip.getBoundingClientRect();
    const left = Math.min(
      window.innerWidth - tooltipBox.width - viewportMargin,
      Math.max(viewportMargin, anchorBox.left + anchorBox.width / 2 - tooltipBox.width / 2),
    );
    const below = anchorBox.bottom + gap;
    const top = below + tooltipBox.height <= window.innerHeight - viewportMargin
      ? below
      : Math.max(viewportMargin, anchorBox.top - tooltipBox.height - gap);
    setPosition({ left, top, maxWidth });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
  }, [message, open, updatePosition]);

  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={tooltipRef}
      id={id}
      className="persistent-disabled-tooltip"
      role="tooltip"
      style={position ? {
        left: position.left,
        top: position.top,
        maxWidth: position.maxWidth,
      } : { left: 0, top: 0, visibility: "hidden" }}
    >
      {message}
    </div>,
    document.body,
  );
}
