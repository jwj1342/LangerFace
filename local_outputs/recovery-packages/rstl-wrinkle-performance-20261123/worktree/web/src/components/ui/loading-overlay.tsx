import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

interface AssetLoadingOverlayProps extends HTMLAttributes<HTMLDivElement> {
  heading: ReactNode;
  text: ReactNode;
  textProps?: HTMLAttributes<HTMLParagraphElement>;
  visible?: boolean;
}

export const AssetLoadingOverlay = forwardRef<HTMLDivElement, AssetLoadingOverlayProps>(
  ({ className, heading, text, textProps, visible = true, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("asset-loading", !visible && "hidden", className)}
      role="status"
      aria-live="polite"
      {...props}
    >
      <div className="asset-spinner" aria-hidden="true" />
      <strong>{heading}</strong>
      <p {...textProps}>{text}</p>
    </div>
  ),
);
AssetLoadingOverlay.displayName = "AssetLoadingOverlay";
