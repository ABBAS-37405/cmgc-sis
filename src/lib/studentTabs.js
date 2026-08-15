import { Home, CalendarCheck, ClipboardList, NotebookPen, FileText, FileBarChart2, Wallet, UserSquare, BookOpen, TrendingUp, Bell } from "lucide-react";

/**
 * The student portal's screens, in order.
 *
 * Two things read this list: `Sidebar` renders it as the nav, and `NextTab`
 * walks it to work out what comes after the current screen. Keeping it in one
 * place is what stops the "Next" button and the menu from disagreeing — reorder
 * here and both follow.
 */
export const STUDENT_TABS = [
  { id: "overview", label: "Overview", icon: Home },
  // Second, because an announcement is time-sensitive in a way none of the
  // records below it are — and it is the same board the public site shows, so
  // she no longer has to leave the portal to read what was posted.
  { id: "notices", label: "Notices", icon: Bell },
  { id: "attendance", label: "Attendance", icon: CalendarCheck },
  { id: "classtests", label: "Class Tests", icon: ClipboardList },
  { id: "assignments", label: "Assignments", icon: NotebookPen },
  { id: "lms", label: "LMS", icon: BookOpen },
  { id: "results", label: "Results", icon: FileText },
  { id: "fee", label: "Fee", icon: Wallet },
  // The last two both look back over everything above them, which is why they
  // sit at the end: Performance draws the term, Reports hands it over as a PDF.
  { id: "performance", label: "Performance", icon: TrendingUp },
  { id: "reports", label: "Reports", icon: FileBarChart2 },
  { id: "myform", label: "My Form", icon: UserSquare },
];

/** The screen after `id`, or null when there is nothing further. */
export function tabAfter(id) {
  const index = STUDENT_TABS.findIndex((t) => t.id === id);
  return index === -1 ? null : STUDENT_TABS[index + 1] || null;
}

/** The screen before `id`, or null when this is the first one. */
export function tabBefore(id) {
  const index = STUDENT_TABS.findIndex((t) => t.id === id);
  return index <= 0 ? null : STUDENT_TABS[index - 1];
}
