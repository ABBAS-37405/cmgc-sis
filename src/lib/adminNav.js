import { LayoutDashboard, Users, UserSearch, CalendarCheck, FileText, Wallet, Bell, BookOpen, ShieldCheck, FileBarChart, HardDrive } from "lucide-react";
import { hasPermission } from "./adminAuth";

/**
 * The admin portal's tabs, and who may see them.
 *
 * This lives outside `AdminSidebar` because two things now need it: the sidebar,
 * which renders the ones she is allowed, and `AdminPortal`, which is handed a tab
 * by a restored session and must not put her back on one she has since lost the
 * right to — every branch there is guarded by the same permission, so a stale tab
 * would restore to an empty screen.
 *
 * The `permission` values are `PERMISSION_KEYS` ids from adminAuth, with two
 * exceptions: `null` means everyone, and the sentinel means super admin only.
 */
const SUPER_ADMIN_ONLY = "__super_admin_only__";

export const ADMIN_NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, permission: null },
  { id: "students", label: "Students", icon: Users, permission: "students" },
  // One girl's whole record on screen. Same `students` permission — the roster it
  // opens with is read through the very policy that key gates, so an admin
  // without it would only ever see an empty list here.
  { id: "progress", label: "Student Report", icon: UserSearch, permission: "students" },
  { id: "attendance", label: "Attendance", icon: CalendarCheck, permission: "attendance" },
  { id: "results", label: "Results", icon: FileText, permission: "results" },
  { id: "fee", label: "Fee Verification", icon: Wallet, permission: "fee" },
  { id: "notices", label: "Notices", icon: Bell, permission: "notices" },
  { id: "lms", label: "LMS", icon: BookOpen, permission: "lms" },
  // Also holds the non-teaching register and payroll — same `teachers` permission,
  // so no new key was added to PERMISSION_KEYS or the RLS policies built on it.
  { id: "teachers", label: "Teachers & Staff", icon: BookOpen, permission: "teachers" },
  { id: "reports", label: "Monthly Reports", icon: FileBarChart, permission: "reports" },
  // Super admin only, like Manage Admins: the safe half of cleanup runs by
  // itself, but deciding that a teacher's file may go is not a sub-admin's call.
  { id: "storage", label: "Storage", icon: HardDrive, permission: SUPER_ADMIN_ONLY },
  { id: "admins", label: "Manage Admins", icon: ShieldCheck, permission: SUPER_ADMIN_ONLY },
];

export function canSeeAdminTab(adminProfile, id) {
  const item = ADMIN_NAV_ITEMS.find((it) => it.id === id);
  if (!item) return false;
  if (item.permission === SUPER_ADMIN_ONLY) return !!adminProfile?.is_super_admin;
  if (!item.permission) return true;
  return hasPermission(adminProfile, item.permission);
}
