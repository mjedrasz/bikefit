import type { SessionStatus } from "@/types";

/**
 * Single source of truth for SessionStatus -> label/Tailwind-class mapping.
 * Consumers combine this with a shared pill base class (see SESSION_STATUS_BADGE_BASE_CLASSNAME).
 */
export const SESSION_STATUS_BADGE_BASE_CLASSNAME =
  "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium";

export const SESSION_STATUS_META: Record<SessionStatus, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-muted text-muted-foreground" },
  processing: {
    label: "Processing",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  },
  completed: {
    label: "Completed",
    className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  },
  failed: { label: "Failed", className: "bg-destructive/10 text-destructive" },
};
