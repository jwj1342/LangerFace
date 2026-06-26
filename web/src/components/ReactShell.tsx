import { forwardRef } from "react";
import type { AnchorHTMLAttributes, HTMLAttributes } from "react";
import { Link, type LinkProps } from "react-router-dom";

import { cn } from "../lib/cn";

export const ReactPage = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("react-page", className)} {...props} />
  ),
);
ReactPage.displayName = "ReactPage";

export const ReactShell = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("react-shell", className)} {...props} />
  ),
);
ReactShell.displayName = "ReactShell";

export const ReactShellSidebar = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <aside ref={ref} className={cn("react-shell-sidebar", className)} {...props} />
  ),
);
ReactShellSidebar.displayName = "ReactShellSidebar";

export const ReactShellMain = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <main ref={ref} className={cn("react-shell-main", className)} {...props} />
  ),
);
ReactShellMain.displayName = "ReactShellMain";

export const ReactShellNavLink = forwardRef<HTMLAnchorElement, LinkProps>(
  ({ className, ...props }, ref) => (
    <Link ref={ref} className={cn("react-nav-link", className)} {...props} />
  ),
);
ReactShellNavLink.displayName = "ReactShellNavLink";

export const ReactShellExternalLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(
  ({ className, ...props }, ref) => (
    <a ref={ref} className={cn("react-nav-link", className)} {...props} />
  ),
);
ReactShellExternalLink.displayName = "ReactShellExternalLink";
