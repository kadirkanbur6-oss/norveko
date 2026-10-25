// lib/notifications-types.ts
// Shape of items returned by /api/notifications.

export interface NotificationItem {
  id: string;
  kind: "job_completed" | "job_failed" | "purchase" | "refund" | "welcome";
  title: string;
  detail: string | null;
  href: string | null;
  created_at: string;
}
