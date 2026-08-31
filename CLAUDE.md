# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Vite dev server (frontend only)
npm run build      # production build to dist/
npm run preview    # serve the built dist/
npm run lint       # eslint .
npm run optimize:images   # regenerate public/images/gallery from _original-photos/
npm run optimize:logo     # regenerate public/logo.png + favicon.png from _original-photos/
node server.js     # Express API on :3001 — must run separately, no npm script for it

npm run dev:demo   # the demo build, on invented data, no Supabase (see DEMO.md)
npm run build:demo # what the demo Netlify site builds
```

There is no test framework in this project — no test runner, no test files, no `npm test`. Don't invent one; verify changes by running the app.

## Architecture

Vite + React 19 SPA for CMGC (Community Model Girls College) — a public marketing site plus a student/parent/admin portal backed by Supabase. Plain JS/JSX (no TypeScript), plain CSS (no framework), no router.

### Two processes

1. **Frontend** (`src/`) — talks directly to Supabase with the anon key (`src/lib/supabaseClient.js`). Almost all reads/writes go straight from components to Supabase; there is no data layer or API client abstraction.
2. **`server.js`** — a small Express service holding the two things the browser must not: the Supabase **service role key** (creating/deleting sub-admin and teacher auth users) and SMTP/Twilio credentials (sending student credentials). Frontend reaches it via `VITE_API_URL` (default `http://localhost:3001`). Every `/api/admin/*` and `/api/teacher/*` route re-verifies the caller's Supabase access token server-side through **one `authorizeAdmin(accessToken, right)`** — `right` null for an admin route (super admin only), `'teachers'` for the teacher routes (super admin, or that permission). Never trust a client-supplied role. Because teacher accounts are auth users, **the Teachers tab needs `node server.js` running**, exactly like Manage Admins does. Both sides call it through `callServiceApi()` in `src/lib/serviceApi.js`, which exists to turn the two failures that actually happen into sentences. A `fetch` that reaches no server rejects with a bare `TypeError: Failed to fetch`, which reads to an admin like a broken form rather than a service she never started. And **no access token at all stops the call before it is sent** rather than earning a 403: `getSession()` refreshes an expired token by itself, so nothing to send means the session is genuinely over — and the portal will not have noticed, because every screen on it is React state that keeps rendering long after the session behind it has gone.

   **It returns which step failed, and that is the point of it.** The two helpers it replaced both collapsed no-token, a token Auth rejected, and a profile without the right into a bare null, so the route could only guess — and every one of them guessed "you do not have permission", which is the wrong answer for an expired session and the one thing the office cannot act on. An expired token is a 401 saying to sign in again and that nothing was changed; a missing permission is a 403 naming the permission; an unconfigured server is a 500 naming `SUPABASE_SERVICE_ROLE_KEY`. The profile read uses `maybeSingle()`, because `single()` turns a missing row into an error that reads as a refusal.

### Navigation is state, not routes

There is no router. `src/App.jsx` early-returns `<Portal>` or `<AdmissionPage>` based on boolean state; `Portal.jsx` early-returns `<LoginPage>` or `<AdminPortal>` based on login/role state; each portal renders its tab from an `active` string. Adding a "page" means adding a state branch, not a route. **URLs never change**, so deep links are not supported by design — and must not be added casually, because an address that reloads to the wrong screen is worse than one that never claimed anything.

**A reload no longer throws that state away, though** — see "Staying signed in" below. What survives is the portal, not the address bar: the URL is still `/` on every screen.

**The browser's Back button is supported, and `src/lib/backStack.js` is the whole of it.** One press walks back one screen inside the site; a press with nothing left to walk back to asks before leaving. It works without URLs because the browser only ever holds **one** guard entry (`arm()` keeps a marked entry above the one the visitor arrived on, so a back press fires `popstate` instead of unloading), while the real record of where she is lives in the module's own stack of undo steps.

Four rules, and breaking any one of them makes Back do nothing or do too much:

- **Whoever navigates forward calls `pushStep`**, at the click, so the closure captures the screen being left. `useTabHistory(active, setActive)` is that wrapper for a portal's tabs — pass its result as `setActive` and the whole nav follows. The undo sets state directly, so returning never pushes.
- **Whoever navigates backward in the UI calls `truncate(token)`.** A Logout or a "Back to Website" button collapses several levels at once; the dead steps above would otherwise sit there and swallow presses. `App` holds the tokens for the portal and the admission form, and `onExit` truncating from the portal down is what also clears the login and tab steps.
- **A step with `confirm` asks first** — used only for signing out of a portal, where a stray press costs an admin her Supabase session. Answering "no" pushes the step back.
- **`BackGuard` is rendered outside every screen branch in `App`**, in all three returns. It is what installs the guard, so unmounting it disarms the back button.

**On a phone every portal has two navs, and that is not a duplicate.** `MobileTabMenu` (fixed bar at the top, a dropdown holding the whole tab list) sits alongside the bottom bar `Sidebar`/`AdminSidebar` already render, and both are hidden at 1024px where the real sidebar takes over. The bottom bar stays exactly as it was — a tab already on screen beats one you must open a menu to find — and the dropdown is the relief for the tabs that scroll off its right edge, which with eleven admin tabs is most of them. It is one component driven from both sidebars off the **same `items` array the bar renders**, so the two can never offer different screens; `variant="admin"` is only the active colour. Two things it owns: it appends its own Logout (so `AdminSidebar` passes `visibleItems`, not the `sidebarItems` that already has one spliced in), and it scrolls to the top on selection, because it is pinned to the top of the screen and landing half way down the next tab reads as nothing having happened. Its 52px is cleared by `padding-top` on `.portal__main` / `.admin-portal__main`, next to the 90px that clears the bottom bar.

`installBackGuard()` is deliberately callable without React: the stack machine is the easy part to get wrong, and that seam is what let it be driven from plain Node against a stubbed `window` — the same reason `reportPdf.js` imports nothing that reaches Supabase.

### Auth: two entirely separate mechanisms, three roles

- **Students/parents** — no Supabase Auth at all. `LoginPage` queries the `students` table for a matching `roll_no` + plaintext `password` column and hands the whole row down as `studentData`. Her session is React state plus the id in `sessionStorage` that restores it (below); there is no token, because there is no account.
- **Admins** — real Supabase Auth (`signInWithPassword`), then `fetchAdminProfile()` loads their `admin_profiles` row. No profile row = no admin access.
- **Teachers** — the same Supabase Auth mechanism as admins: sign in with email + password, then `fetchTeacherProfile()` loads the `teachers` row matching `user_id`. No row (or `is_active: false`) = signed straight back out. `teachers` holds no password column; only the `students` table still uses the plaintext-password login.

### Staying signed in

Refreshing used to drop whoever was working back onto the landing page, because everything that said "she is in the portal, on the Fee tab" was React state and nothing else. `src/lib/session.js` fixes that with one `sessionStorage` key holding **the role, the tab, and — for a student only — the id of her row**. No password, no record, nothing that could not be read again from the database.

**`sessionStorage`, and the auth token with it — this survives a reload and nothing longer.** It exists for a refresh, a crash, a phone killing the tab, not for the office computer being shut for the night: `localStorage` outlives the browser, so closing it left the next person to sit down already signed in as the admin. `supabaseClient.js` therefore passes `auth: { storage: window.sessionStorage }` as well, because our own marker calling the session over while a live refresh token stayed behind would be a logout in appearance only. **The two must agree** — change one and the other decides on its own how long a session lasts. Both files also clear what the old localStorage default left behind, once, on first load. The accepted cost: a second tab is a second session, so opening the portal in a new tab means signing in again. Not airtight against a browser configured to reopen its tabs, which can restore `sessionStorage` with them — closing that gap needs an idle timeout, not a storage change.

- **`session.js` imports nothing, and must stay that way.** `App` reads `storedSession()` synchronously to decide what to render (so the website is never painted and then yanked away), and App is the landing bundle. The half that turns a marker back into a signed-in portal needs the Supabase client and both profile fetchers, so it lives in **`sessionRestore.js`** and is imported only from `Portal`, which is already lazy. Merging them measured **+4.5 kB on the landing bundle** to answer a question about a session a first-time visitor has not got.
- **The marker says which profile to load; the database says whether she is still allowed in.** Admin and teacher restore through `supabase.auth.getSession()` — supabase-js persists that itself — then `fetchAdminProfile` / `fetchTeacherProfile`. A revoked login, a deleted profile row, a teacher set `is_active: false`, a deleted student: each returns null, clears the marker, and lands on the login page. A failed restore is never retried.
- **A student has no auth at all**, so hers is an id and a re-read of her row as `anon` — the same read her Attendance tab already makes. Re-reading rather than storing the row means a password change or an edit is picked up on the next load instead of being carried around stale. The consequence is honest and worth stating: for a student, "still signed in" is exactly as strong as "this browser profile is hers". That is why **Logout clears the marker** rather than only dropping React state, and `signOutToLogin` (the Back-button sign-out) clears it too.
- **A restored tab is validated, never trusted.** `canSeeAdminTab()` in `src/lib/adminNav.js` is the sidebar's own filter, exported so `AdminPortal` can refuse a tab whose permission has since been withdrawn — every branch there is guarded by that permission, so a stale tab would restore to a blank main area. `TeacherPortal` checks the same way against her `items`. That is why `ADMIN_NAV_ITEMS` moved out of `AdminSidebar`: a component file may not export non-components (fast refresh).
- **Nothing is remembered in the demo.** `__DEMO__` folds to false in a real build and takes the branch with it; in the demo the auth is in-memory, so a remembered admin would restore to a session that no longer exists and land on the login page — worse than the landing page it lands on today.

### Admin permissions model

`src/lib/adminAuth.js` owns `PERMISSION_KEYS` (`students`, `attendance`, `results`, `fee`, `notices`, `lms`, `teachers`, `reports`). It re-exports `PROGRAMS`, which is **derived from `src/lib/academics.js`** — see below. These string values must match the DB and RLS policies exactly.

- `is_super_admin: true` → everything, plus the "Manage Admins" tab.
- Otherwise `permissions[]` gates which tabs render (`AdminSidebar` filters nav, `AdminPortal` guards the render), and `allowed_programs[]` scopes which students they can touch. **Empty `allowed_programs` means all programs, not none** — `allowedProgramsFor()` returns `[]` for super admins too, and components treat `[]` as unrestricted.
- The UI gate is cosmetic; the real enforcement is RLS policies on `students`/`attendance`/`results` documented in `SUPABASE_ADMIN_ROLES.md`. Changing a permission key or program name means updating both places.

**A write RLS refuses does not return an error.** PostgREST answers an `update`/`delete` that matches no policy-visible row with a plain success and zero rows — `error` is `null`. Inserts are the exception; they raise `42501`. So any update or delete that matters must ask for the rows back (`.select("id")`) and treat an empty array as failure, otherwise the UI reports "saved" while the database ignored it. `WRITE_BLOCKED_HINT` in `adminAuth.js` is the shared message; the two causes are an expired admin session (the request went out as `anon`) and a sub-admin reaching outside her `allowed_programs`.

### Groups and subject combinations

`src/lib/academics.js` defines every group as a list of **elective combinations**, and everything else is derived from it: `PROGRAMS` is its keys, `subjectsFor(group, year)` is that group's electives plus the compulsory subjects of that year. Adding a group means editing `GROUP_COMBINATIONS` only — the admission form, admin dropdowns, attendance, results and class tests all pick it up. It needs no SQL: `students.program`, `admin_profiles.allowed_programs` and `teachers.programs` are unconstrained text and the RLS policies compare by value.

Most groups have a single combination. **FA-IT (2 options) and Humanities (3) let the applicant choose**, and `groupHasChoice()` is what drives that branch in `AdmissionPage`. The pick is stored as a readable string in `applications.subject_combination`, then copied to `students.subject_combination` on approval (`supabase_fa_it_group.sql`).

**`subject_combination` is a filter, not just a record**, and `src/lib/studentSubjects.js` is the single definition of it. Offering a group's whole list to every girl in it was wrong wherever a group has more than one combination: a Maths class test listed every Humanities girl, including the two thirds who take Civics instead, and an Economics test did the same across FA-IT and Humanities. Four screens go through that file — `ClassTestEntry` and `AssignmentEntry` filter their roster by `splitBySubject(students, subject)`, `EnterResults` builds one girl's marks sheet from `studiedSubjects(...)`, and `buildTestReport` filters the class it ranks and prints slips for. See "Who actually sits a subject" below.

**The year is the one thing that does narrow that list.** `COMPULSORY_SUBJECTS` is the union of both years, and `YEAR_ONLY_COMPULSORY` marks the two that belong to one year only — **Islamiat is examined in 1st year and Pakistan Studies in 2nd**. So `subjectsFor(group)` and `SUBJECTS[group]` (no year) are the union, for the screens with no class in hand — the teacher's subject chips, `ALL_SUBJECTS`, the public Programs note; every screen that *does* know the class passes it (`EnterResults` from `student.year_of_study`, `ClassTestEntry`/`AssignmentEntry` from their year selector, `subjectsForPrograms(programs, year)`, `teacherSubjectsFor(teacher, programs, year)`). Nothing in the database constrains `results.subject`, so this is a UI list only — which is why `EnterResults` unions in any subject the girl **already has a mark in**: saving deletes that exam's rows and writes back the list on screen, so a subject missing from the sheet would silently discard marks entered under an older list.

### Supabase schema (no migrations in-repo)

Schema changes are hand-run SQL documented in markdown at the repo root, and applied manually via the Supabase dashboard. When you change the data model, add/update the corresponding doc. The teachers/class-tests migration additionally ships as a runnable `supabase_teachers_migration.sql` — the markdown explains it, the `.sql` file is what gets pasted, so keep them in sync if you touch either.

- `SUPABASE_ADMIN_ROLES.md` — `admin_profiles`, `is_super_admin()`, all RLS policies (also records a known open issue: `students_delete` is still scoped to `anon`).
- `SUPABASE_CHANGES.md` — `students.profile_picture_url` + `student-profiles` storage bucket.
- `SUPABASE_FEE_ADMIN_ENTRY.md` — `payment_transactions.recorded_by`.
- `supabase_fee_plans.sql` — the `fee_plans` table, `fees.label`/`fees.year_of_study`, and the seeded plans for all 12 (year, group) pairs.
- `supabase_fa_it_group.sql` — `subject_combination` on `applications` and `students`.
- `supabase_lms.sql` — `lms_materials`, **and the `lms-materials` bucket with its read/upload policies**. That bucket used to be a "create it by hand in the dashboard" note, which is exactly the step that got missed: the LMS looked fine until the first teacher attached a PDF and got `Bucket not found`, and only text and links had ever been published. It is created in SQL now, like the `assignments` bucket. Only staff may upload (`is_staff()`); reads are open to `anon` because students have no auth account. The matching delete policy lives in `supabase_storage_cleanup.sql`. Also back-fills the new `lms` right onto every teacher who already holds `class_tests`.
- `supabase_profile_edit_requests.sql` — `profile_edit_requests`, plus the only write path students have. See "Student self-service edits" below; the column-level `grant update (...) on students to anon` in there is the hard ceiling on what a student can ever change, and `STUDENT_EDITABLE` in `src/lib/profileEdit.js` must mirror it.
- `supabase_bform_unique.sql` — partial unique indexes making one B-Form mean one girl: `applications_bform_unique` (exempts soft-deleted and `Rejected` rows so a rejected applicant may re-apply) and `students_cnic_unique`. Both index `regexp_replace(…, '[^0-9]', '', 'g')`, so a number typed with or without dashes is the same number.
- `supabase_student_details.sql` — the 25 columns that bring `students` up to parity with `applications` (`whatsapp`, contact, personal, family/finance, matric record, and the five document URLs), plus a backfill joining `applications a` on `a.bform = s.cnic` with `coalesce` so nothing already set is overwritten, and a `whatsapp = phone` fallback.
- `supabase_monthly_reports.sql` — the `reports` storage bucket and the `report_log` table behind Monthly Reports. Adds no columns to anything: the report is assembled in the browser from tables that already exist. Note the security trade recorded at the bottom of that file — report PDFs sit in a public bucket because the parent opening the link has no login.
- `supabase_portal_messages.sql` — `portal_messages`, the one-paragraph message that opens as a dialog in a student or teacher portal. Adds no column to `notices` and reuses `admin_can_notices()`; the file is mostly the write-up of why a student-audience message is not private in the way a teachers one is.
- `supabase_notices_upgrade.sql` — `notices.body` / `file_url` / `file_name` / `audience`, the `notice-files` bucket, and a **rebuild of every RLS policy on `notices`**. The rebuild is the part to read: the select policy was open to `anon` with no condition, which was right while every notice really did go to the college and is a leak the moment one does not. It now returns `audience = 'all'` to anon and everything to signed-in staff. Existing policy names differ between databases (this table predates the SQL files here), so they are read out of `pg_policies` and dropped in a `do` block rather than guessed at — a permissive policy is OR'd in, so one survivor undoes the whole thing.
- `supabase_teacher_password_vault.sql` — `teacher_login_passwords`, the one table a super admin can read a teacher's portal password out of. See "Reading a password back" below.
- `SUPABASE_TEACHERS_CLASS_TESTS.md` — `teachers.user_id`/`rights[]`/`subjects[]`, `class_tests` + `class_test_marks`, the `is_staff()` / `teacher_can()` helpers and every policy built on them. Note the `teacher read students` policy is mandatory: `students_select` is scoped to `anon`, and admins only read students through their own write policy, so without it a teacher's portal shows an empty roster everywhere.

- `supabase_attendance_exclusion.sql` — `students.attendance_excluded_at` / `attendance_excluded_reason`, and the `protect_student_fields` trigger extended to cover them. See "Out of the attendance register" below.
- `supabase_storage_cleanup.sql` — `lms_materials.file_archived_at`, the `storage_usage()` / `storage_objects_in()` reader functions, and the **delete policies these buckets never had**. Nothing in the app could delete a file before this: a delete matching no policy returns a plain success, so a sweep would have reported freeing space it had not freed. See "Storage cleanup" below.
- `supabase_expenses.sql` — the `expenses` table behind Reports → Accounts. Adds nothing else: income is read from `payment_transactions` and the wage bill from `staff_salaries`, both of which already exist. Gated on `can_manage_teachers()`, and the reason is written up in the file — see the Accounts section below.
- `SUPABASE_STAFF_PAYROLL.md` / `supabase_staff_payroll.sql` — payroll for everyone the college pays: `teachers.employment_type`/`monthly_salary`/`per_day_salary`/`whatsapp`, the `staff` table (non-teaching), plus `staff_attendance`, `college_holidays` and `staff_salaries`. The markdown explains it, the `.sql` is what gets pasted — keep them in sync, same arrangement as the teachers migration. Section 0 of the `.sql` renames the tables from an earlier teacher-only version of this migration, so it is safe on a database that already ran that one.

Tables in use: `teacher_login_passwords`, `students`, `admin_profiles`, `teachers`, `staff`, `applications`, `attendance`, `results`, `class_tests`, `class_test_marks`, `assignments`, `assignment_submissions`, `fees`, `payment_transactions`, `notices`, `portal_messages`, `report_log`, `staff_attendance`, `college_holidays`, `staff_salaries`, `expenses`. Storage buckets: `student-profiles`, `admission-documents`, `assignments`, `reports`, `lms-materials`, `notice-files` (all public).

### Fee flow

`fee_plans` holds the price list — one row per (year, group) with `admission_fee`, `monthly_fee`, an admin-set `total_fee`, and an `installments` jsonb array describing the payment schedule. `src/lib/feePlans.js` is the only place that reads it: `buildFeeRows()` turns a plan into the actual `fees` rows, and `StudentsList.doApprove()` writes the whole year's schedule at enrolment rather than one admission charge. The amounts used to be frontend constants; they are now editable from **Fee Verification → Fee Settings** (`FeeSettings.jsx`), so never reintroduce a hardcoded fee.

Each installment is `{ label, months, due_month }`; the charge is `months × monthly_fee`, and `due_month: null` means "at admission" (a week after enrolment). `buildFeeRows` walks the schedule forward, pinning each due date at or after the previous one — that is what makes a 2nd-year plan land Sep–Dec in the enrolment year and Jan–Apr in the next, and stops a late enrolment from dating February before November. `fees.label` is what the student's Fee tab shows; rows predating fee plans have none and fall back to the group name.

`fees` holds the charge; `payment_transactions` holds individual payments. A fee's `status` (`Unpaid` / `Partially Paid` / `Pending Verification` / `Paid`) is **derived and written back** from the sum of that fee's `Success` transactions — this recompute is duplicated in `Fee.jsx` (student view) and `FeeVerification.jsx` (admin approve/reject/unpaid tabs). Change one and check the other. `recorded_by` distinguishes `'student'` (submitted proof, admin approved) from `'admin'` (cash recorded directly at the office, no proof).

### Admission → enrollment

The B-Form number identifies the applicant — names repeat and sisters share phone numbers. `src/lib/bform.js` owns it: `findBFormClash()` runs before any upload or insert (admission form, Add Student, and the edit modal, which passes `ignoreStudentId` so she doesn't clash with herself), and `describeUniqueViolation()` turns a `23505` into a sentence. The pre-check is courtesy, not enforcement — two submissions in the same second both pass it and the unique indexes catch the second, so never drop the error handling in favour of the check.

`AdmissionPage` writes an `applications` row with documents uploaded to `admission-documents`. Admin approval in `StudentsList.doApprove()` flips the application to `Approved`, inserts a `students` row (roll no `CMGC-{year}-{last 5 of Date.now()}`, default password = last 6 digits of B-form or `cmgc123`), and creates an admission `fees` row. Note the `window.open("", "_blank")` opened *before* the awaits — it reserves the popup inside the click gesture so the WhatsApp credential handoff isn't blocked; don't move it below an `await`.

### Student self-service edits

`MyForm` (student portal) shows her whole record; `EditRequests` (a tab inside the admin Students tab) is where the admin answers. She raises a request saying what is wrong, approval stamps `approved_until = now() + 48h`, and until that passes she may edit and save as often as she likes.

The design exists because **students have no Supabase Auth** — every request from the student portal is the `anon` role, so the database cannot tell one student from another. Two things carry the weight:

- The `students` UPDATE policy for `anon` opens only where an approved, unexpired request exists **for that row**, not for students generally.
- A column-level `grant update (...) on students to anon` caps what may ever be written — 15 contact/personal/family columns. Roll number, password, B-Form, program, year, marks and documents are not grantable through any request, so widening `STUDENT_EDITABLE` alone does nothing but produce silent no-op saves.

The residual risk is stated in the SQL file and is deliberate: during an open window, anyone who knows that student's UUID could write those same columns. Closing it properly means giving students real auth accounts.

### Student Report — one girl's whole record

The sidebar's **Student Report** tab (`StudentProgress/StudentProgress.jsx`, aggregation in `src/lib/studentProgress.js`) answers the question asked at the office counter: pick a student, see how she has done since admission — attendance month by month, every class test by subject, every exam sitting, assignments, fee charges and payments — without opening five screens and reading them against each other.

It is **the mirror image of `monthlyReport.js`**, and that is the whole design: that file takes a whole roster for one month, this one takes one student for her whole career. So the arithmetic is not rewritten — `summariseAttendance`, `summariseTests`, `summariseAssignments` and `summariseFee` are exported from `monthlyReport.js` and imported here. Duplicating them would mean two definitions of "how a fee's paid amount is derived", which is exactly the drift the `Fee.jsx` / `FeeVerification.jsx` recompute already suffers from. It adds no table and no SQL: every figure comes from tables the other screens already write.

Four things to keep:

- **It writes nothing.** The only mutation reachable from it is the existing `StudentDetail` modal, opened rather than re-implemented — the same admission record the Students tab edits.
- **The tab is gated on `students`, and the two RLS-gated sections hide rather than show zero.** `attendance` and `results` are readable by an admin only if she holds the matching permission (the program-scoped policies are `for all`, so they govern select too), and **RLS refuses a read as silently as a write**. Running those queries for an admin without the right would return zero rows, and "0% attendance" for a girl who never missed a day is a lie. So the query is skipped and the section says why. Same reasoning as the Accounts gate; the tab itself needs `students` because the roster is read through that very policy. No new `PERMISSION_KEYS` entry, so nothing in the database changed.
- **Dates are sliced, never parsed.** The month of an attendance mark is `row.date.slice(0, 7)` and date columns are formatted from their own `YYYY-MM-DD` parts — `new Date("2026-08-01")` is UTC midnight and lands in July for anyone east of Greenwich, the same trap `monthKeyOf` avoids in `accounts.js`.
- **Six queries per student, and Back walks out of the record before it leaves the tab.** Opening a student calls `pushStep`, the "All students" button calls `truncate` — the two rules from the back-stack section. A `requestRef` token drops a slow load that arrives after the admin has moved on.

### Charts

`src/components/Charts/Charts.jsx` is the whole charting layer — `ColumnChart`, `BarChart`, `LineChart`, `Meter` and the `ChartCard` shell — in **hand-written inline SVG with no dependency**. Recharts and its peers are 90–300 kB against a landing bundle held at ~428 kB; a library that size to draw four shapes would be the most expensive thing in the app. Everything it draws obeys one set of rules so the three portals read as one system:

- **Data colour never comes from `--accent`.** The visitor can set the accent to any hue (`AccentPicker`), and a data colour has to survive colour-blindness and a contrast floor, which an arbitrary hue does not. The three series steps were validated as a set against this project's own card surfaces — `#f8fafc`, `#ffffff` and `#1e293b` — for the lightness band, chroma floor, colour-blind separation (worst all-pairs deutan ΔE 9.2 light / 9.4 dark against a floor of 8) and normal-vision separation (24.0 / 20.9 against 15). Chrome (grid, ink, surface) does follow the theme, so all four palettes stay coherent. Re-validate before changing a step.
- **Every chart carries its numbers.** `ChartCard` takes a `table`, rendered under a "Show the numbers" toggle. A tooltip may never be the only way to read a value — and the aqua slot sits at 2.7:1 on the light cards, below the 3:1 bar, so that table is its documented relief rather than an extra.
- **One series per chart, so none of them needs a legend.** Nothing here plots two things at once; the title says what is plotted. A fourth series is never a generated hue — it is a fold into "Other" or a second chart.
- **Marks are thin, chrome is recessive.** Bars cap at 24px with a 4px rounded end and a square baseline, lines are 2px, dots carry a 2px ring in the *surface* colour (never a darker outline — that is ink which is not data), gridlines are solid hairlines. Never dashed: a dash reads as "threshold" when it is only a grid.
- **Sizing is measured, not scaled.** A `ResizeObserver` gives the real pixel width and the SVG is drawn at that size, so 11px axis text is 11px on a phone too. Scaling a fixed `viewBox` would shrink the labels to nothing on the screen most of these parents actually hold. Two consequences that were found by rendering it and looking: a reference line's label is parked **outside** the plot (right padding grows to fit it) because right-aligning it inside puts "75%" on top of the last bars on a narrow card, and column labels drop to every other one below a 26px band, counted from the right so the newest month keeps its name.
- **Nothing is drawn for a value nobody recorded.** Callers pass only what exists and `empty` prints the reason instead of an axis with nothing on it — the same rule as `notMarked` never printing as 0.

### Performance screens

Three screens sit on top of that layer, and they are two components, not five:

- **`Performance/StudentCharts.jsx`** — one girl's attendance by month (with the 75% line), class tests by subject, exam trend across sittings, and fee/assignment meters. It takes a `buildStudentProgress` object, so the **admin's Student Report and the student's own portal draw from the same call** and cannot disagree. Same principle as her Reports tab generating the identical PDF her parents are sent.
- **`Performance/MyPerformance.jsx`** — the student portal's `performance` tab (in `STUDENT_TABS`, before Reports). It passes `can = () => true`, and that is not a shortcut: the permission argument exists because an *admin* is refused `attendance` and `results` by RLS unless she holds those keys, while a student is `anon`, whose select policies on those tables are what her Attendance and Results tabs already run on.
- **`Performance/ClassPerformance.jsx`** + `src/lib/classPerformance.js` — class tests across a class rather than down a student: average per test, weighted average by subject, grade distribution in the board's bands, and (admin only) a breakdown by teacher. `teacher={her}` is her own tab in the teacher portal, gated on the `class_tests` right because that right is what produces the marks; `teacher={null}` is the **Reports → Class Performance** sub-tab. Same shared-component arrangement as `ClassTestEntry` and `LmsManage`.

Three things `classPerformance.js` will not do: average an absent girl in as a zero (she is counted separately and left out, exactly as `testReport.js` does it); claim a roster it did not fetch (it says "marks recorded", never "students", because whoever was never marked is not in the data at all); or weight a four-girl test like a forty-girl one (buckets sum marks and totals and divide once, rather than averaging the averages). The by-teacher chart is labelled on screen as where to look rather than as a score — classes differ, and a chart that ranks teachers by their students' marks invites exactly the reading it cannot support.

### LMS

`lms_materials` is one row per thing a teacher or admin publishes for a subject — a recorded lecture, an old paper, the paper scheme, notes, a link. `LmsManage` writes them — shared by both portals like `ClassTestEntry`, taking a `teacher` for her own subjects or `teacher={null}` plus `allowedPrograms` for the admin's full-range view — `Lms` (student portal) reads them, and `src/lib/lms.js` holds everything the two must agree on: `LMS_CATEGORIES` (the `id` values are stored, so they are not free to rename), and the YouTube helpers.

A row carries any combination of written text, a link and a file, so the same screen covers "watch this lecture" and "here is what to revise". Groups work exactly like `class_tests` — `program` holds a single group or the `"All Programs"` literal, `programs[]` holds what it actually covers, and the student query filters on `programs`.

`parseYouTube()` accepts watch URLs, `youtu.be`, playlists, shorts, embeds and a video-inside-a-playlist; anything else returns null and the student gets a plain "Open link" button instead of a player. Playback is `youtube-nocookie.com`, and every video also offers "Open on YouTube" — a playlist embed keeps the playlist.

**"Your teacher has uploaded something new" is derived, not stored.** `src/lib/lmsAlerts.js` plus `components/LmsAlert/` put a short notice on her Overview naming what went up, and a count on the LMS nav item. It adds **no table and no SQL**, and that is forced rather than clever: a student has no Supabase Auth account, so a per-girl notification row could be written by anyone and scoped by RLS to nobody — and `notices` cannot carry it either, because it deliberately has no audience column, while material for 2nd year Pre-Medical is not for the college. `fetchMaterialsForStudent` already returns exactly her group and her year, so "new" is that list against one timestamp per student in `localStorage`.

Three rules there:

- **The first visit announces nothing.** With no stored timestamp, treating everything ever published as unread would greet a girl opening the portal on a new phone with a term's worth of "new" material. `firstVisitSeenAt` stamps now instead, so only what arrives afterwards is ever announced. A notice that is wrong the first time is one nobody reads the second time.
- **Opening the tab is what marks it read** — `Portal` calls `seen()` when `activeTab` becomes `lms`, so there is nothing to dismiss once she is looking at the material. `dismiss()` is the separate "not now": the banner goes, the badge stays, and it is back next sign-in.
- **The notice names the material rather than counting it.** "3 new items" gives her nothing to decide on; `summariseNewMaterial` names two and counts the rest. The stored key is per student id, because a shared family phone signs two sisters in and one reading her LMS must not mark the other's as read.

The honest cost: "last looked" is per browser, so her mother's phone has its own idea of what she has seen. The alternative needs real student accounts.

Unlike the `class_tests` policies, which settle for `is_staff()`, the write policy checks entitlement to **every** group the row covers — `bool_and(teacher_can('lms', p))` for a teacher, `admin_can_lms()` (the `lms` permission plus `programs <@ allowed_programs`) for an admin. A combined item is therefore not a way to reach a group you were never assigned.

### Who actually sits a subject

`src/lib/studentSubjects.js` answers one question — does this girl study this subject — and everything that needs it goes through that file, so there is one definition. Her group is the floor, not the answer: Humanities offers three elective combinations and only one of them takes Mathematics, so "Humanities" cannot decide a Maths roster. `students.subject_combination` can, and does.

**Three states, not two, and the third is the load-bearing one.** `subjectStatusFor()` returns `"yes"`, `"no"` or `"unknown"`. A student enrolled before that column existed, or added by hand without one, carries no combination; in a group that offers a choice there is then genuinely no way to tell. **Excluding her would hide her from marks entry entirely and nothing would ever say why** — her marks simply would not exist. So `"unknown"` counts as taking (`takesSubject`), and `splitBySubject()` carries those girls out separately so the screen can name them. The same rule as `notMarked` never printing as 0 and as the storage sweep never deleting on the strength of a failed read: show too much and say so, never quietly show too little.

`components/RosterNote` is that sentence, shared by Class Tests and Assignments rather than written twice — how many the subject left off the sheet, and which girls are on it only because their combination is missing, with where to fix it. `EnterResults` says the same thing in its own words, and only for the two groups where the group name does not settle it.

**Where that note sends her is `StudentDetail`'s Subject Combination field, and it is a select over `combinationsFor(group)`, never a text box.** A typed line is how the fix fails: one misspelling or an extra subject and `pickedElectives` drops it, so she reads as unrecorded again and nothing on screen says why. `combinationIndexFor(group, combination)` matches what is stored as a *set* of that group's electives, so "Civics, Education, Sociology" is recognised as the combination it is rather than as a fourth option. Three things it will not do: replace a stored line that matches nothing (it stays as an option, labelled, because that is what her marks screens are reading today); offer a choice to a single-combination group (the group settles it, and the field says so); or carry a combination across a group change (`changeProgram` clears one the new group does not offer — a Humanities combination under Pre-Medical is not a record, it is a wrong answer).

Three more things to keep:

- **Every screen that filters must also select the column.** `subject_combination` (and `year_of_study`, for the compulsory half) has to be in the `select(...)`, or every girl comes back `"unknown"` and the filter silently does nothing. That is the failure mode to watch for: it looks exactly like the bug it was meant to fix.
- **Compulsory subjects are nobody's choice**, and the year still narrows them — Islamiat is 1st year, Pakistan Studies 2nd. A single-combination group (Pre-Engineering, Pre-Medical, ICS, General Science) is decided by the group alone and never reports `"unknown"`.
- **It is split from `academics.js` for bundle reasons.** That file is reached from the landing page, so anything in it ships to a first-time visitor; leaving this logic there measured **+703 bytes on a bundle held at ~431 kB**. Same split as `session.js` / `sessionRestore.js` and `notices.js` / `noticesAdmin.js`. It imports only `academics.js`, so it stays Node-drivable.

**Marks already recorded are not touched.** A mark written before this — a Maths score against a Humanities girl who does not take Maths — stays in `class_test_marks`, and nothing deletes it. Cleaning that up is a decision for the office, not something to do silently. What changed is who is shown it: it drops off the entry sheet and the test report, because both build their roster through this file, and it is now dropped from everything the girl herself sees as well.

**The other half of the same file: what she is shown, not who is on the sheet.** `splitOwnSubjects(student, rows, subjectOf)` narrows rows that carry a subject down to hers, and every student-facing screen goes through it — `ClassTests`, `Results`, `Assignments`, `fetchMaterialsForStudent` (so the LMS tab *and* the "new material" alert agree), `buildStudentProgress` and `buildMonthlyReports`. Without it the portal showed whatever carried her id: a girl whose combination had been recorded wrong appeared on an Economics test sheet, was marked, and then read Economics on her own portal, her charts and her parents' report long after the roster screens had stopped listing her for it.

Four rules there, three of them the ones this file already follows and one that is only true on this side:

- **Only a definite `"no"` is dropped.** `"unknown"` still shows everything, exactly as it is still listed on every entry sheet.
- **Her year is deliberately not applied**, and this is the one place that differs from the entry sheets. Islamiat is examined in 1st year and Pakistan Studies in 2nd, so `subjectStatusFor` answers `"no"` to Islamiat for a 2nd year — right for this term's sheet, and quite wrong for her record, where those 1st-year Islamiat marks are marks she actually sat. `splitOwnSubjects` clears the year and lets only the elective combination decide. Node caught this, not the browser.
- **The admin's Student Report names what was dropped and her own portal does not.** `buildStudentProgress` returns `outside`, and `StudentProgress` prints it: those marks are now invisible on every other screen, so without that line the office would have no way of noticing a wrong combination at all. She is shown nothing, because a subject she does not study is not hers to correct.
- **`buildMonthlyReports` filters inside `assembleReport`**, so the PDF the office sends and the PDF she downloads are the same document, and neither lists a subject her portal does not.

### Teachers & class tests

`teachers.rights[]` gates the teacher portal exactly like `admin_profiles.permissions[]` gates the admin one — keys are defined in `src/lib/teacherAuth.js` (`class_tests`, `view_students`, `attendance`, `results`). `teachers.subjects[]` and `teachers.programs[]` scope her further, and **empty means unrestricted**, same convention as `allowed_programs`. Unlike the admin UI gate, these are backed by RLS: `teacher_can(right, program)` is what the `attendance`/`results` teacher policies check.

A `teachers` row can exist with `user_id` null — a recorded teacher who has no login yet. The Teachers tab shows "Create Login" for those, which posts to `/api/teacher/create` with a `teacherId` to attach an auth user to the existing row rather than inserting a new one.

**"Send Login" WhatsApps a teacher her own credentials, and it is not the student flow with a different table.** A student's password is a plaintext column, so `StudentsList` can quote it back at any time; a teacher's is a real Supabase Auth account, so the portal only ever sees a hash and **nothing can be recovered from it** — see the vault below for what is recorded going forward.

**Sending therefore changes nothing and asks nothing.** One button, one job: it opens the chat. The message quotes a password only when the admin set one on this screen a moment ago — `knownPasswords`, in memory only, keyed by teacher id, fed by Add Teacher, by an edit that set a password, and by Reset Password — and otherwise names the office as where her password came from. **Setting a password lives behind "Reset Password" and nowhere else.** An earlier version prompted for one on send whenever it was not known, and then reset her login to match; that is wrong twice over, because the office usually presses send to pass on an email, and a teacher who is already signed in and working should not be logged out by it. The same map means Reset Password followed by Send sends the new password with no second dialog. Nothing is awaited between the click and the chat, so no window has to be reserved against the popup blocker.

**`ManageAdmins`' "Send WhatsApp" is identical, for the identical reason** — a sub-admin login is a Supabase Auth account too. It originally asked for the password on every send through an empty box that read as a reset and was not one: what was typed went into the message and nowhere else, so a half-remembered password could reach someone who then could not sign in with it. Both screens now share one shape: send quotes what it knows, Reset Password is the only thing that writes.

#### Reading a password back — super admin only

The office needs to answer "what is her password" at the counter, for both rosters. The two halves are not the same problem and are not solved the same way.

- **A student's is simply displayed.** `students.password` has always been plain text, because a student has no Auth account. So the Enrolled Students table grows a **Password** column for `is_super_admin` only — hidden behind a per-row eye, with a Copy button and a "Show all" in the heading. Nothing in the database changed and no new query runs; the column was already on every row the list fetches. It starts hidden because that table is read at a counter with parents on the other side of it.
- **A teacher's cannot be read at all, so it is recorded when it is set.** Supabase Auth keeps a bcrypt hash; a password already in use is gone, and no key recovers it. `teacher_login_passwords` (one row per teacher, `on delete cascade`) is written by **server.js and nothing else** — the table deliberately has no insert/update/delete policy, so only the service-role key can put a value in it, on exactly the two routes that change a password (`/api/teacher/create`, `/api/teacher/password`). That is what guarantees the stored value is the one Auth was actually given. The select policy is `is_super_admin()`.

Four consequences worth keeping in mind:

- **A login created before this migration reads "not recorded", and that is the truth, not a bug.** It must never render as a blank value — an empty box reads as a password of nothing. Reset Password is the only way to give such a teacher a readable one.
- **A failed vault write takes the old row down with it.** `recordTeacherPassword()` in `server.js` deletes rather than leaving a stale value, because a stale password reads as working and is not — the office would read it out to a teacher who then cannot sign in. It returns a `warning` in the response instead of failing the request, since the password change itself already succeeded, and logs it server-side so a cause other than the missing migration leaves a trace. That warning is deliberately **not** alerted on the reset — an alert saying "done" and "failed" in the same breath reads as a broken button. The strip described below says it once instead, in the place that can act on it.
- **A sub-admin with the `teachers` permission can still set a password but never read one.** `authorizeAdmin(token, 'teachers')` gates the write; `is_super_admin()` gates the read. And **RLS refuses a read as silently as a write**, so `fetchTeacherPasswords()` never raises — which is also what keeps the tab working before the migration is run.
- **"Nothing set yet" and "no table" are opposite instructions, so the vault reports which.** `fetchTeacherPasswords()` returns `{ ready, passwords }`, not a bare map. Both used to read as an empty map, so every card said "use Reset Password to set a new one" — and the office resets a password, watches it not appear, and resets it again, because it cannot appear until `supabase_teacher_password_vault.sql` is run. `ready: false` raises one strip above the roster naming that file, and the per-card sentence stops giving an instruction that will not work. A refusal for anyone who is not a super admin reads as `ready` with nothing in it, which is right: she is not meant to see any of this.

`knownPasswords` (in-memory, this visit only) still exists alongside the vault and still wins, because it is what an admin typed a moment ago and is never staler. It is what lets a sub-admin who cannot read the vault still press Add Teacher and then Send Login.

Class tests are two tables on purpose: `class_tests` is one row per test conducted, `class_test_marks` one row per student per test with a `unique (class_test_id, student_id)` constraint that `ClassTestEntry` upserts against. That shape is what lets each subject carry a different number of tests — the student's `ClassTests` tab groups marks by subject and renders each subject's own horizontal strip of tests.

A test can span groups: picking `"All Programs"` stores that literal in `class_tests.program` and the concrete groups it covered in `class_tests.programs[]`. Always build the roster from `programs[]`, falling back to `[program]` — reading `program` alone silently returns nobody for a combined test.

`ClassTestEntry` is shared: pass a `teacher` and it locks to her subjects/programs and stamps her id on new tests; pass `teacher={null}` plus `teacherOptions` and it becomes the admin's full-range view.

#### Student Uploads — the third view of `assignments` and `lms_materials`

`TeacherUploads/TeacherUploads.jsx` is a **Teachers & Staff** sub-tab, super admin only, listing everything the staff has published to students — assignments and LMS material together, newest first, filterable by teacher — with **Edit** and **Delete** on each row.

It exists because `AssignmentEntry` and `LmsManage` are both organised around *setting something new*: you pick a class, a subject and a group, and only then see what is there. Neither can answer "what has this teacher published", and **neither can change an item once it is up**. The office's actual questions are a paper uploaded to the wrong class, a due date that has to move, a chapter number wrong in a title.

- **It adds no table and no SQL.** `assignments_update` / `assignments_delete` are `is_staff()`, and `lms_write_staff` is `for all` — a super admin already satisfies `admin_can_lms` (super admin, empty `allowed_programs` = unrestricted).
- **There is no Add button, deliberately.** Creating belongs on the screens that know the eligibility rules — which groups study which subject, which years a subject is examined in — and a second copy of those rules would drift within a term.
- **What may be edited is the content; what may not is the audience.** Subject, groups, and for an assignment the class, are fixed. They decide whose roster the item is graded against, and re-scoping an assignment girls have already submitted to leaves their `assignment_submissions` pointing at a roster they are no longer on. The screen says so and points at delete-and-set-again.
- **Deleting reuses what already exists.** An assignment is a hard delete (submissions cascade, and the confirm says so); material goes through `removeMaterial` from `lib/lms.js`, which soft-deletes *and* removes the file — so there stays one definition of taking material down.
- **Both writes ask for their rows back.** `.select("id")` on the update and on the assignment delete, zero rows → `WRITE_BLOCKED_HINT`, the rule from the RLS section.
- **Replacing an LMS file deletes the one it replaced, after the row points at the new one.** Replacing an *assignment* file does not: the `assignments` bucket has no delete policy on purpose (a submission is a student's own work and the only copy of it), and that bucket is never swept, so a replaced question paper orphans. Accepted rather than hidden — question papers are capped at 10 MB by the `submission` upload kind and replaced rarely.

Class tests are not in this list. Nothing is uploaded for one — it is marks, and the Class Tests and Report sub-tabs next door already cover them.

### Staff payroll — two rosters, one calculation

The sidebar's **Teachers & Staff** tab covers everyone the college pays. There are **two rosters and they are separate tables on purpose**:

- `teachers` — teaching staff, with subjects, programs, rights and a Supabase Auth login.
- `staff` — everyone else: accounts, office, security, maintenance, transport. Guards, peons, drivers and sweepers live here. No `user_id`, no login, no subjects.

A guard is not a `teachers` row with blank columns. Putting him there would drop him into every screen that builds a teacher dropdown by reading `teachers` — class tests, LMS, assignments, the class-test report. `src/lib/staff.js` owns the vocabulary: `STAFF_DEPARTMENTS` is fixed (the salary sheet groups by it), while `designation` is free text offered as a datalist, because a fixed job-title list would be the first thing to need a migration.

**Only the payroll is shared**, and it works because nothing in `src/lib/payroll.js` reads a subject, a program or a right — an accountant and a physics teacher price identically. That is why its functions take a `person`, not a `teacher`, and why `ownerColumnFor(person)` (keyed on `person.kind`) is the single place that decides whether a row is written against `teacher_id` or `staff_id`. `staff_attendance` and `staff_salaries` each carry both columns with a **check constraint that exactly one is set**.

`payroll.js` **imports nothing that reaches `supabaseClient`** — same discipline as `reportPdf.js`, and for the same reason: the arithmetic is the part that quietly goes wrong, so it has to be drivable from plain Node against fixtures in a repo with no test runner.

Everyone is either **Regular** (fixed `monthly_salary`) or **Visiting** (a `per_day_salary` — the college's word, and the same arrangement as a daily-wage sweeper). The two are priced by different rules, not one rule with a parameter:

- **Regular** — absence is a *deduction*. The first leave-or-absence each month is free (`FREE_ABSENCE_DAYS`); every day after costs `monthly_salary ÷ that month's working days`.
- **Visiting** — `present days × per_day_salary`. There is no deduction, because nothing was owed for a day not worked.

Working days are the month minus Sundays (`WEEKLY_OFF_DAY`, applied in code — Sundays are never rows) minus `college_holidays`. That one definition is what produces the asymmetry the college asked for: a holiday cannot touch a Regular salary because it was never a working day, and is unpaid for a Visiting employee because they were not present. Neither is a special case in the code.

**The present days can be corrected by hand, and only a super admin is offered the box.** Under *Edit Adjustments* on a salary card, next to bonus and other deduction, for both rosters and both employment types; blank — the default for everybody — means the register decides and the month prices exactly as it always did. It exists because the register is filled in every morning and is sometimes simply wrong (a week nobody marked, a teacher who came in during the holidays, days agreed at the office that were never entered), and repairing a month of the register to fix one figure is not something anybody actually does.

- **It is a correction, so it changes one input, not the pay rule.** Visiting is paid off the stated days directly. For Regular, the working days the correction does not claim become absence (`working days − present − half days ÷ 2`), which the free day and the per-day rate then price exactly as always. Where the register is complete that is arithmetically the absence it already held — `working days = P + A + L + H` — so **a correction that agrees with the register changes nothing at all**, which is what makes it safe to state as an absolute rather than as a nudge.
- **This does not weaken "an unmarked day is not an absence"; it is the case where nothing is unmarked.** Nobody may read silence as "she didn't come", and the difference-based alternative was considered for exactly that reason and rejected: it hands back a full salary however few days are typed, on the incomplete register that is the main reason the box exists. A super admin stating 20 present in a 26-working-day month has accounted for the whole month. `computeSalary` therefore reports `unmarkedDays: 0` once a count is stated (the register's own figure stays as `registerUnmarkedDays`), and that one line is what stops the card, the slip, the PDF and her own portal each promising that days the correction did deduct cost her nothing.
- **A corrected figure is never printed bare.** `registerPresentDays` comes back from `computeSalary` alongside it, and the card, the CSV, the payslip PDF, the WhatsApp slip and the teacher's own My Salary tab all say what the register had recorded beside what the office set. A number nobody can check against the register is a number the office cannot defend at the counter.
- **`present_days_override` is carried on every write, not just the one that set it.** Mark Paid and Record Amount upsert the whole row, so leaving it out of `persist` silently drops the correction and re-prices the month.
- **The gate is the UI's alone and the database does not repeat it.** Any admin who reaches this screen can already set a bonus, which moves the same total by the same amount, so a column-level restriction would protect nothing; `can_manage_teachers()` stays the real boundary. `StaffPayroll` takes `adminProfile` for this — the same shape as `MarkAttendance`'s "Out of register".

Four rules that are easy to break:

- **An unmarked day is not an absence.** It is counted as `unmarkedDays` and shown, but never deducted. Reading "nobody filled the register" as "they didn't come" takes money off someone who was at work — the same principle as `notMarked` never printing as 0 in a test report.
- **Saving the register is two upserts, not one.** A teacher row conflicts on `(teacher_id, date)` and a staff row on `(staff_id, date)`, and PostgREST takes one conflict target per request. `DailyRegister.save()` splits the batch for exactly this reason; merging it silently drops one side.
- **Everything on the Salary screen is recomputed from `staff_attendance` on open.** `staff_salaries` stores only what cannot be derived — `bonus`, `other_deduction`, `notes`, `present_days_override` — plus the payment record and a snapshot of what was shown. Correcting an attendance mark therefore corrects the payslip immediately.
- **`status` is derived and written back** from `paid_amount` against `net_payable`, exactly like a fee's. `salaryStatusFor()` is the only definition; do not re-derive it in a component.

**The teacher portal has a "My Salary" tab** (`src/components/TeacherSalary/TeacherSalary.jsx`), so a teacher can see her own attendance, the working behind her figure, her payment history and download her payslip. Three things about it:

- **It is not in `NAV_ITEMS` and is never filtered by `hasTeacherRight`.** A right is something the admin grants; her own pay is not the admin's to withhold. It is appended to the nav unconditionally, and it is checked before the "no duties assigned" branch so a teacher with no rights yet still lands on a working portal.
- **It needed no new policy.** `staff_attendance_select` and `staff_salaries_select` already allow `is_this_teacher(teacher_id)`, so her queries return her rows and nobody else's — the database scopes this, not the UI.
- **It recomputes rather than reads.** Same `computeSalary()` on the same attendance rows as the admin sheet, so the slip she downloads cannot disagree with the sheet the office works from — neither of them stores the answer. Which is exactly why it must read every stored input the admin sheet reads: the bonus, the other deduction, **and `present_days_override`**. Anything left out of that list is a way for her slip and the office's sheet to state two different figures.

`src/lib/payslipPdf.js` renders the slip and follows both `reportPdf.js` rules: **jsPDF is `import()`ed inside the handler**, never at module top level (it is ~400 kB, and both the teacher portal and the admin portal statically import their tabs — a top-level import would put the PDF engine in both chunks for everyone who never downloads one), and it **reaches nothing that touches `supabaseClient`**, taking a finished `calc` so it can be driven from plain Node against fixtures. The admin's "Payslip" button on each salary card calls the identical function, so the office and the employee hand out the same document.

Three screens, all sub-tabs of Teachers & Staff and all gated by the existing `teachers` permission (no new `PERMISSION_KEYS` entry, so the RLS built on it is unchanged): `Teachers.jsx` (teaching roster, and it owns the `staff` fetch because payroll needs the same list), `AdminStaff/AdminStaff.jsx` (non-teaching roster — plain Supabase writes, no server round trip, since nobody in it has a login), and `StaffPayroll/StaffPayroll.jsx` (the daily register plus the monthly sheet). Writes go through `.select(...)` and treat zero rows as failure — a refused RLS write returns success, see `WRITE_BLOCKED_HINT`. Bulk WhatsApp is a **queue, not a loop**, like every other bulk send in the project. `buildSalaryMessage()` spells out the working rather than just the total, because a slip that only states a figure invites the argument it exists to prevent.

### Reports

The `reports` tab holds four screens, all gated by the `reports` permission. The first three are scoped by `allowed_programs` like every other admin screen; the fourth is about the college rather than any student.

- **Monthly Reports** — one PDF per girl for a month: attendance, class tests, assignments, fee position. Class tests only; this tab never touches `results`.
- **Exam Reports** — one PDF per girl for one term exam: its marksheet, plus the same attendance/assignments/fee context.
- **Test Reports** — one class test across a class: a result sheet with positions, grades and class statistics, then a page per girl to send home. `src/lib/testReport.js` owns it.
- **Accounts** — fee income against salaries and running costs, month by month and for the year. See below.

**Monthly and Exam are the same component.** `ReportsPane.jsx` takes `mode="monthly" | "exam"`; `MonthlyReports.jsx` is only the tab shell. They differ in exactly one thing — whether an examination is part of the report — and everything else (month/group/class filters, section ticks, the two bulk downloads, the per-student PDF, the WhatsApp queue) is deliberately identical. Splitting them into two files would be four hundred duplicated lines that drift apart the first time either is touched. The shell passes `key={tab}` so switching modes remounts the pane rather than carrying the other one's filters and half-finished send queue.

Two controls decide what a report says, and both flow through every path — the individual PDF, the bulk PDF, the ZIP and the WhatsApp text:

- **The exam.** Monthly mode always passes the `EXAM_CLASS_TESTS` sentinel, which fetches no `results` at all. Exam mode passes a real `results.exam_name`, matched verbatim and **with no date filter** — a Pre-Board sat in December is exactly what an admin wants to send out in January, and scoping it to the report month would silently return nothing. The month still governs the attendance, assignments and fee sections.
- **The section ticks** (`DEFAULT_SECTIONS`, all on). An unticked section is not drawn at all — not drawn empty, not drawn with a "not included" note. `buildReportMessage()` honours the same object, so the WhatsApp text never quotes a figure the PDF behind it does not contain. The class summary sheet drops the matching column and footer statistic too.

`src/lib/exams.js` is the single definition of `EXAM_TYPES`. `EnterResults` builds `results.exam_name` from it by pinning a type to a date ("Pre-Board Exam - 15 August 2026") or a month ("Monthly Test - August 2026"), nothing in the database constrains that column, and `examTypeOf()` reads the type back out by prefix — longest first, so a short type cannot claim a longer one's rows. **It lives outside `academics.js` on purpose**: that file is reached from the landing page, and exam vocabulary is only ever needed inside the admin chunk. Moving it there costs the landing bundle real bytes for nothing.

The exam dropdown is populated from `fetchExamNames()` — what is actually in the table — because there is no list of sittings anywhere else. Which one is selected is **derived during render**, not stored: the admin's pick when it still belongs to the chosen type, otherwise the newest of that type. An effect that stored it would change the selection once the list arrived and trigger a second full load.

Files: `src/lib/monthlyReport.js` and `src/lib/testReport.js` aggregate, `src/lib/reportPdf.js` renders all of it, `ReportsPane.jsx` + `TestReports.jsx` are the screens. Nothing is stored that could be recomputed — every report is assembled from existing tables when it is opened.

**`reportPdf.js` imports nothing that reaches `supabaseClient`, and it must stay that way.** That is what lets the whole PDF layer be driven from plain Node against fixture data, which is the only way any of it gets exercised in a repo with no test runner. It is why grading lives in `testReport.js` (`gradeFor` stamps `row.grade`) rather than in the renderer, and why `buildTestReport` returns finished rows rather than raw marks.

Two rules the test-report maths follows, both easy to get wrong: **positions are dense-ranked with gaps** (equal marks share a position and the next is skipped — 1, 2, 2, 4), and **a girl with no mark row is not a zero.** She is `notMarked`, keeps `obtained: null`, is excluded from the average, the positions and the pass count, and gets no page of her own. Printing 0 for "not yet marked" would be a lie that reaches a parent.

The ZIP path hands JSZip an `ArrayBuffer`, never the Blob jsPDF returns — JSZip only recognises Blob inside a browser and fails with "Can't read the data" anywhere else.

**A combined download mixes orientations**: the summary sheet is landscape (with every column ticked it needs ~195mm of table, which A4 portrait cannot hold — autotable squeezes it and warns), each student's report is portrait. So nothing spanning the page width may assume 210mm: `drawBandHeader`, `drawFooter` and `ensureSpace` all read `pageW(doc)` / `pageH(doc)`, and `drawFooter` reads them *after* `setPage(i)` because they differ page to page.

**A link is not a design choice, it is the only option.** Click-to-chat cannot attach a file (see the WhatsApp section below), so the PDF is uploaded to the public `reports` bucket and the message carries its URL. The path is `monthly/<YYYY-MM>/<student uuid>.pdf`: the UUID is what makes it unguessable, and `upsert: true` means regenerating a month replaces the file so links already sent keep working. The trade — anyone the message is forwarded to can also open it — is written up at the bottom of `supabase_monthly_reports.sql`, along with the signed-URL alternative.

Three things here are easy to break:

- **`buildMonthlyReports()` takes the whole roster at once**, not one student. Six queries serve a class of any size; calling it per student inside a `.map()` is exactly the pattern the Performance section forbids. The class-test query needs `class_tests!inner(...)` because `class_test_marks` carries no date of its own — the `test_date` filter has to reach the parent row.
- **jsPDF is imported dynamically inside `loadPdfLib()`, and JSZip inside `buildReportsZip()`.** jsPDF and its optional deps are ~800 kB, JSZip another 96 kB; a static import would fold the PDF engine into the admin chunk for every admin who never opens the tab. The landing bundle must stay at 419 kB.
- **Sending is a queue, and the popup window is reserved before the `await`.** PDF generation and upload both take time, and a `window.open` fired after them is blocked — `send()` therefore takes a `windowRef` the caller opened inside the click gesture, the same trick `StudentsList.doApprove()` uses.

`report_log` is one row per student per month, upserted on `(student_id, month)`, purely so the list can show "Sent 3 Aug" and nobody gets messaged twice. It snapshots the two percentages that were actually sent, which is not necessarily what the tables would produce later if a mark is corrected. Logging is best effort: `fetchReportLog()` swallows its error and returns `{}` so a portal running before the migration still works.

`results` has no exam date, so "this month's result" means the marks were **entered** this month (`created_at`) — a term exam sat in March but typed in May lands in May's report.

**The student portal has its own Reports tab** (`src/components/Reports/Reports.jsx`), so a girl or her parents can take the report themselves instead of waiting for it on WhatsApp. It is the same `buildMonthlyReports` + `buildReportPdf` pair as the admin's, with a roster of one — the download she gets is the document her parents receive, not a second version that could disagree. She may pick any of the last 12 months and, from `fetchExamNames()`, any exam she has marks for; sections are all on (`result` only in exam mode), because it is her own record.

Three things about that tab:

- **It generates, it never uploads.** `uploadReportPdf` writes to the `reports` bucket, whose insert policy is `authenticated and is_staff()` — a student session is `anon`. Only the admin's copy is ever stored.
- **`reportPdf.js` is `import()`ed inside the download handler**, not at the top of the file. Portal statically imports every student tab, so a static import would put the PDF layer in the portal chunk for every student who never opens Reports.
- **"Already shared by the college" comes from storage, not `report_log`.** The log is staff-only under RLS and the student is `anon`, so `fetchSharedReport()` asks the bucket instead: the path `monthly/<YYYY-MM>/<uuid>.pdf` is deterministic, so one `list` scoped to her own file name answers it without exposing anyone else's. Best effort like `fetchReportLog()` — a refused list just drops the line. That file carries whichever sections the admin ticked, which is why it is offered alongside the generated one rather than instead of it.

### Accounts — the college's own books

The fourth Reports screen (`MonthlyReports/Accounts.jsx`, arithmetic in `src/lib/accounts.js`) answers what the other three cannot: did the college make money this month, and this year.

**Two of its three inputs are not stored anywhere new.** Income is the sum of `payment_transactions.amount` where `status = 'Success'`; the wage bill is the sum of `staff_salaries.paid_amount`. Both are written by screens the office already uses daily, so the ledger cannot drift from Fee Verification or the salary sheet — and correcting either one corrects this page immediately. The only table this tab owns is `expenses`, for the bills, rent and repairs that live nowhere else.

**The ledger is cash basis on both sides**, and that is the decision everything else follows from. Income is money received, not fees invoiced; salary cost is `paid_amount`, not `net_payable`. Billing one side and cash the other is how a college with a term of unpaid fees convinces itself it had a good year. What is still owed to staff is carried as `salaryPayable` and shown, but it never enters the net.

**A salary must never be entered as a misc expense.** It is already counted from `staff_salaries`, so it would be charged twice. There is deliberately no "Salaries" entry in `EXPENSE_CATEGORIES`, the form says so, and `supabase_expenses.sql` repeats it — this is the one input that produces a confidently wrong total.

Four more things that are easy to break:

- **The tab is gated on the `teachers` permission, and that is correctness, not policy.** Most of the expense side is payroll, `staff_salaries_select` is `can_manage_teachers()`, and **RLS refuses reads silently** exactly like it refuses writes. An admin without it would be shown the full fee income against an empty wage bill and told the college is in profit. `MonthlyReports.jsx` filters the tab out, `expenses` carries the matching policy, and the salary query's error is surfaced rather than swallowed. No new `PERMISSION_KEYS` entry, same as the payroll screens.
- **A month with nothing in it is not a month that broke even.** `buildLedger` marks it `empty`, and the table prints "—" rather than a confident Rs 0 profit — the same principle as `notMarked` never printing as 0 in a test report.
- **Rows dated outside the period are dropped, not folded into the nearest month**, so the year total always equals the sum of the rows on screen.
- **`monthKeyOf` slices the date string; it must not use `new Date()`.** `expenses.spent_on` is a plain `date` — parsed as UTC midnight it moves anything spent on the 1st into the month before. And when the office records a cash payment, `created_at` is written as the chosen day's UTC midnight, so slicing hands back exactly the date the admin picked. Reading either in local time is what breaks them.

Salaries are charged to the **month worked** (`staff_salaries.month`), not the day the wage was handed over, so an April salary paid in May is April's cost. Income is dated by the day of payment. The period selector offers both a calendar year and the college's own May–April financial year rather than guessing which it keeps — deliberately not Pakistan's July–June government year. A period is defined by `startMonth` on its `PERIOD_MODES` entry, which `monthsOfPeriod` and `periodLabelOf` both read, so moving a boundary is one number.

`accounts.js` **imports nothing that reaches `supabaseClient`** — same discipline as `payroll.js`, `reportPdf.js` and `xlsx.js`, and for the same reason: the arithmetic is the part that quietly goes wrong, so it has to be drivable from plain Node against fixtures in a repo with no test runner.

### Attendance — "classes held?" is per class, not per college

`MarkAttendance` is shared by the admin portal and the teacher portal, and its **"Classes held?"** toggle answers for **the roster on screen** — the current program and year filter — never for the college.

A college day is rarely all-or-nothing: 2nd year sits an exam while 1st year is sent home, one year comes in during holidays for practicals. The toggle originally deleted every attendance row for the date **across all programs and both years**, so answering No while looking at 1st year wiped the 2nd year register that had just been filled in. It is now scoped with the same `student_id in (visible ids)` filter the save path already used, names the class in its confirmation, and asks for the deleted rows back (`.select("id")`) because a delete RLS refuses returns a plain success — see `WRITE_BLOCKED_HINT`.

Two rules behind it:

- **An unmarked day is not an absence**, here as everywhere else in this app (`notMarked` in test reports, `unmarkedDays` in payroll). So a class that had no college needs nothing saved at all — the accurate record is an empty register, and the No answer exists for undoing a day that was already marked by mistake, not for recording the holiday.
- **The answer does not travel.** Changing program, year or date resets it to Yes, because it is a question about one class on one date. Carrying it across meant an admin who marked 1st year as off found the 2nd year roster unmarked with nobody auto-present and no visible reason why.

**The screen opens on All Programs and 1st Year.** Neither default is arbitrary. The program used to be `visiblePrograms[0]` for a scoped teacher and a hardcoded `"Pre-Medical"` for an admin: the first showed an Economics teacher assigned three groups a single girl out of ten, because `PROGRAMS` lists General Science before FA-IT and Humanities and General Science has one girl in it; the second had nothing to do with the admin at all. "All Programs" is already narrowed to `visiblePrograms` in `fetchRoster`, so opening on it shows nobody anything they were not already allowed. The year opens on 1st Year rather than Both because the register is filled in one class at a time, and a roll call that starts with both years mixed together is the longer list to scroll and the easier one to mark the wrong girl on. **The same first-group-only default was in `EnterResults`, `ClassTestEntry`, `AssignmentEntry` and `LmsManage`** — all five are fixed, and the three multi-select screens now pre-tick **every group a teacher is entitled to** whenever a `teacher` is passed at all (`eligiblePrograms` still drops any that does not study the chosen subject). Note the condition is `teacher || isRestricted`, not `isRestricted` alone: an empty `teachers.programs[]` means unrestricted rather than unassigned, so a teacher nobody has scoped was the one case still being dropped onto the first group in `PROGRAMS`. An admin, whose visible groups are nobody's in particular, keeps the pick-one default.

### Out of the attendance register

A girl can be enrolled and still not be part of the daily roll call — long medical leave, studying privately, stopped coming but her record is not to be closed. Left in the roster she is marked Absent every morning by whoever fills it in, and the percentage her parents are sent collapses for a reason that has nothing to do with her. **`students.attendance_excluded_at`** (with an optional `attendance_excluded_reason`) takes her out; null means she is in it.

It is a third state, not a variant of the two that already exist: `deleted_at` hides her everywhere, `is_passout` says she finished, this says she is enrolled but off the register.

- **Only a super admin, and the database is what enforces it.** `MarkAttendance` takes `adminProfile` (the admin portal passes it, the teacher portal does not) and shows the per-row "Out of register" button and the **Out of Attendance** tab only for `is_super_admin`. The real gate is `protect_student_fields_on_update()` in `supabase_attendance_exclusion.sql` — the same trigger that already guards `is_passout` / `deleted_at` / `year_of_study`, now covering these two columns. Unlike an RLS refusal it *raises*, so a refusal reaches the admin as a sentence rather than as a silent success.
- **Nothing already recorded is touched.** Taking her out stops new marks being offered; her existing `attendance` rows stay, so her portal, her reports and her Student Report still show the term she did attend. Putting her back leaves the days in between unmarked, which is not the same as absent — the rule the whole app follows.
- **The exclusion filter is the roster, not a view.** `fetchRoster()` is the single query behind both the screen and the downloaded sheet, so a girl off the register is on neither. It retries once without the filter on `42703`: the register is filled in every morning and a frontend deploy can land before the SQL is pasted into the dashboard, and an empty class with no explanation is the worse failure.
- **The Out of Attendance list ignores the program/year filters on purpose** (it is still scoped to `allowedPrograms`). Whoever was taken out has to stay findable without remembering which filter she was excluded under — otherwise she stays off the register for a term by accident. The register itself says how many of the class on screen are missing from it, since it cannot show them.
- **That tab carries the struck-off warning** — "contact the office immediately or her name will be struck off the rolls" — as a per-row button and as a bulk run through the usual `useWhatsAppQueue`. It is not the absence message with harder words: that one reports a day, this one is the last step before her enrolment ends, so it states what has already happened, what is asked, and what follows, and invents no deadline. The two buttons exist because the list holds girls who have stopped coming *and* girls on leave the office already agreed to, and only the office can tell them apart — the bulk button says so on screen rather than assuming. Nothing is recorded when it is sent; there is no warning log.
- **Both views render their own `<WhatsAppQueue>`, so `changeView` calls `wa.stop()` on any switch**, because it unmounts the banner — the rule from the WhatsApp section: whichever screen owns a `useWhatsAppQueue` must stop the run wherever it stops rendering the banner.
- **`carryRecordsRef` carries the unsaved marks across the reload** that excluding or restoring triggers. Both change `students`, which re-runs the effect that rebuilds the day's register from the database — and that would silently discard whatever the admin had ticked but not yet saved. The ref is consumed once, so a date change still reloads properly.

Reports are deliberately unchanged: an excluded girl simply has no attendance rows for those months, which every summary already reads as "nothing recorded" rather than as absence.

### Spreadsheet downloads

`src/lib/xlsx.js` writes a real `.xlsx` — an OOXML package assembled by hand and zipped with JSZip. It exists because the monthly attendance register is worked on in Google Sheets, and a CSV arrives there with no column widths, no frozen headings, no merged cells and no bold, so the sheet had to be re-formatted by hand every month.

It follows the same two rules as `reportPdf.js` and `payslipPdf.js`: it **imports nothing that reaches `supabaseClient`** (so it can be driven from plain Node against fixtures), and **JSZip is `import()`ed inside `buildXlsxBlob`**, never at module top level — 96 kB has no business in the admin chunk for an admin who downloads nothing.

Cells are primitives or `{ v, s }`, where `s` is an index into `S` — the style ids match the order of `cellXfs` in the styles part, so adding a style means appending to both. Two things about the format are unforgiving: the child elements of `<worksheet>` and `<styleSheet>` must appear in schema order (`sheetViews`, `sheetFormatPr`, `cols`, `sheetData`, `mergeCells`, `pageMargins`, `pageSetup`), and fill index 0 must be `none` with index 1 `gray125` before any fill of your own. Excel rejects the file outright rather than degrading if either is wrong.

`MarkAttendance` is the only caller, and it writes **three** sheets from one roster (`fetchRoster`, so a girl out of the attendance register is on none of them).

**Filled / Blank Attendance Sheet.** Columns are `Rno` (last three digits — the rest of `CMGC-YYYY-NNNNN` is identical for everyone and costs three day columns of width), `Name`, `Group` (short forms from `GROUP_SHORT` in `academics.js`), then one column per day of the month under two merged heading rows — the date above, its weekday below, Sundays tinted — and P/A/L totals at the end. Nothing is stored in short form; `students.program` and the RLS policies still see the full group name.

**Student Contact List.** Roll number, name, father's name, group, class, and all three numbers on the record — `whatsapp`, `phone`, `phone2`. Not an attendance sheet: no month, no day columns, nothing to write in, and it ignores the download month for that reason. Two deliberate differences from the sheets above, both because the width compromise no longer applies: the **full** roll number (a truncated one is no use for ringing somebody up) and the **full** group name. WhatsApp and phone stay separate columns because they are frequently different numbers — that is the whole reason `whatsappNumberFor()` exists, and collapsing them throws away exactly the distinction the office needs when one of the two does not answer. Every cell is written as a string, because a spreadsheet that reads `03001234567` as a number drops the leading zero that makes it a Pakistani mobile.

### WhatsApp

`src/lib/whatsapp.js` is the only place that builds a WhatsApp link — `StudentsList`, `MarkAttendance`, `FeeVerification` and `Teachers` all go through it, and none of them keeps a local number normalizer. The glyph is shared too: lucide carries no brand icons, so `components/WhatsappIcon` holds the one hand-drawn path both credential buttons render.

- `whatsappNumberFor(person)` reads `whatsapp` first and falls back to `phone`. Never message `phone` directly: the two are often different numbers and the phone on file may have no WhatsApp on it.
- **Every chat opens in one named tab, `WHATSAPP_WINDOW_NAME`.** `_blank` means "a new tab, always", so marking a class left a tab per girl, each one a fresh WhatsApp Web load. A named target is reused by the browser, survives losing the JS handle (a re-render, a portal reload) where a reference does not, and is what makes a single send and a queue that reserved its window share one tab instead of fighting over two. `reserveWhatsAppWindow()` is that same name, for the callers that must open the tab inside the click gesture before slow work (`StudentsList.doApprove`, `ReportsPane`, `useWhatsAppQueue`). **`noopener` may not be passed with it** — it is defined as "open in a fresh context", which defeats the reuse; acceptable here because the target is WhatsApp's own origin and the queue already holds a live handle to it. Each open also `focus()`es the tab, since a chat loaded behind the portal reads as a button that did nothing.
- `whatsappUrl()` sends desktop straight to `web.whatsapp.com/send` and mobile to `wa.me`. `wa.me` on a laptop is a redirect hop that frequently lands on the "download WhatsApp" interstitial and loses the prefilled text — that is what made laptop sending unreliable.
- Bulk sending is a **queue, not a loop**. `window.open` fired repeatedly in one tick gets blocked after the first tab, and WhatsApp Web drops chats pushed at it in the same second.

Click-to-chat can only pre-fill — a human must press Send. Actual automated delivery needs the WhatsApp Business API: `POST /api/send-credentials` in `server.js` (email via SMTP, WhatsApp via Twilio) is wired for it but `SMTP_*` / `TWILIO_*` are not set in `.env`, so the deep-link path is the one in use.

**`components/WhatsAppQueue` is the whole of bulk sending**, and it is one implementation on purpose — the popup and focus handling below is subtle enough that a second copy would drift within a term. `useWhatsAppQueue()` is the machine, `<WhatsAppQueue>` is its banner, and `MarkAttendance` drives it twice — absence reminders on the register, the struck-off warning on the Out of Attendance tab. `openWhatsAppQueue()` in `lib/whatsapp.js` is the older click-per-chat helper and is no longer used by anything.

**The queue advances by itself**, because a class of thirty meant thirty clicks in the portal on top of thirty presses of Send. The admin answers a single `confirm` and never touches the tab again. Four things make that work, and each one is load-bearing:

- **One window is reserved inside the confirm click** and held in `windowRef`; every later chat is a `location.href` assignment on it. Navigating a window you already own is not a popup, so it needs no gesture — that is the whole reason the queue can move without a click. Losing the reserved window (she closes the tab) is detected by `openAt` returning false, which stops the run rather than falling through to a `window.open` that would be blocked.
- **The advance trigger is `blur`/`focus` on `window`, not `visibilitychange`.** They are not interchangeable: an admin running the portal and WhatsApp side by side in two windows never hides either tab, so `visibilitychange` would never fire. Losing focus covers that and the tab-switch case both.
- **`armedRef` is a ref, and the effect has no dependency array.** No deps means the listener never closes over a stale queue; the ref means an unrelated re-render while she is away in WhatsApp cannot disarm it. Arming is what stops the very first return — the one caused by opening the tab — from skipping a recipient.
- **Entries arrive already screened and already carrying their message.** Anything that could raise a modal has to be resolved before `start` — `sendAbsenceWhatsApp`'s prompt for a missing number is right for a single-row button and fatal for a queue, where one dialog half way through strands every recipient after it. Whoever cannot be messaged goes in `skipped` and is named when the run finishes.

The cost of this design is that returning from *any* other window advances the queue, which the banner says out loud alongside a Stop button. Removing that ambiguity means the Business API, not more event plumbing. **A screen that hides the banner must also stop the run** — the hook lives in the screen, not the banner, so whichever screen owns a `useWhatsAppQueue` must call `wa.stop()` wherever it stops rendering the banner; without that the queue keeps opening chats with nothing on screen saying so.

### Notices

`notices` is one row per announcement — `title`, an optional `body`, `category`, `created_at`, an optional attachment (`file_url` / `file_name`), and an `audience`.

**`src/lib/notices.js` is the single definition of all of it** — the categories, the icons, the tag colours, the audiences and `fetchNotices`. The three reader screens used to hold their own copy of the category list with a comment in each begging the next person to keep them in step, and it had already drifted: "Fee" and "Academic" were being posted before either was in the admin's own list, so they rendered on the board with no icon and an unstyled tag. Same arrangement as `whatsapp.js` owning every chat link.

**It is split in two, and that is bundle discipline rather than tidiness.** `NoticeBoard` renders on the landing page, so anything reachable from `notices.js` ships to a first-time visitor — keeping `postNotice` there dragged `uploads.js` and `storageCleanup.js` in with it and measured **+5.8 kB on a bundle held at ~430 kB**. The writing half therefore lives in **`noticesAdmin.js`**, imported only from `Notices.jsx`, which is in the admin chunk. Exactly the `session.js` / `sessionRestore.js` split, for exactly the same reason.

Four screens, and `StudentNotices.jsx` is two of them:

- `Notices.jsx` (admin) posts, attaches and deletes.
- `NoticeBoard.jsx` is the public landing-page section.
- `StudentNotices.jsx` takes a **`reader` prop** and serves both portals — `"public"` for the student's **Notices** tab (second in `STUDENT_TABS`), `"teacher"` for the teacher portal's. One component, because the screen is identical and only the audience differs; the same arrangement as `ClassTestEntry` and `LmsManage` serving two portals. Category filters are narrowed to the categories actually present, because a filter that can only ever return nothing is a dead button.

**The audience column is a deliberate, minimal retreat from "a notice goes to the college".** That was the right rule while every notice really did, and it is still the default: `audience` is `'all'` unless the admin says otherwise, so every row posted before this existed, and every ordinary notice, behaves exactly as it always has. The only other value is `'teachers'` — how the office sends the staff an instruction (a meeting, a marks deadline, an invigilation duty) that is nobody's business on the public board. There is still **no per-group or per-student audience**, and there should not be: material for 2nd year Pre-Medical is what the LMS is for.

Three things about it that are easy to get wrong:

- **The scoping is in the database, not in the browser.** The anon select policy returns `audience = 'all'` and nothing else; signed-in staff see everything. The `reader` filters in `fetchNotices` say what a screen *means* to show — they are not what keeps a student out of a staff instruction. Both halves are wanted, because RLS drops rows as silently as it drops writes, so a screen that asked for everything and trusted the refusal would look identical whether the policy was doing its job or not.
- **The teacher's Notices tab is not gated on a right**, exactly like My Salary and for the same reason: a right is a duty the admin hands out, and an instruction from the office is how the office reaches her at all. It is appended to the nav unconditionally and checked *before* the "no duties assigned" branch, so a teacher with no rights yet still lands on a working portal.
- **An attachment is public even when the notice is not.** Reads on `notice-files` are open to `anon` because a student has no auth account to check — the same trade the `reports` bucket makes, written up at the bottom of `supabase_monthly_reports.sql`. The notice *text* is properly scoped; its file is only as private as its URL. Do not attach anything to a staff notice that would matter in a stranger's hands.

Adding a category means editing `NOTICE_CATEGORIES` and `CATEGORY_ICON` in `lib/notices.js` (plus `CATEGORY_COLOR` for the public board's tint), and nothing else. The `id` strings land in `notices.category`, so they are not free to rename once posted.

#### The next test, blinking on the home page

`TestAlert` (in the hero, above the title) lifts one fact out of the weekly test schedule notice — the very next test date — to where a visitor sees it without scrolling. `src/lib/testSchedule.js` derives it; there is **no table, no column and no SQL**, the same forced arrangement as `lmsAlerts.js`: `notices` carries a holiday and a fee deadline in the same rows, so a date column there would be null on almost all of them.

- **The date is parsed out of the text the office already types.** `isTestSchedule` wants "test" *and* a scheduling word, so a result announcement never claims the banner; `datesInLine` reads `2026-09-05`, `05/09/2026` (day first, as Pakistan writes it), `5 September` and `September 5`. A bare `10-12` is deliberately **not** a date — that is a lesson timing, and requiring a slash or a year is what keeps it out.
- **Dates are built from their own parts, never `new Date(string)`** — the UTC-midnight trap `monthKeyOf` avoids in `accounts.js`. `testSchedule.js` imports nothing, so all of it is drivable from plain Node against fixtures.
- **The date usually lives in the attachment, and that is where it is read from.** The college's own notice says "PLEASE OPEN THE FILE ATTACHED" and carries an .xlsx of the whole year, so when the text yields nothing `nextTestFromGrid` reads the spreadsheet: the DATE column is found by its heading, and the row's other cells become the label ("XI: URDU · XII: ENG"), minus the serial number, the weekday and any class marked `-`. Asking the office to type the dates a second time is the kind of rule nobody remembers in week nine of term.
- **`src/lib/xlsxRead.js` is the mirror of `xlsx.js`, and it loads no zip library.** Unzipping is `DecompressionStream` plus a central-directory walk — JSZip is 96 kB and has no business on the landing page. It must read the **central directory**, not the local headers: LibreOffice (which wrote the college's file) streams its entries and leaves the local sizes at zero, so a local-header reader inflates an empty stream and throws. The whole file is `import()`ed only once a schedule attachment is actually found, so a page without one pays nothing. Only `.xlsx` is fetched — a PDF or a photo of the notice board cannot be read, and downloading one would be for nothing.
- **It renders null rather than guessing.** No schedule notice, a schedule that is only a photograph, an unreadable file, every date past, or a date more than `MAX_AHEAD_DAYS` out: the hero looks exactly as it did before. Same rule as `notMarked` never printing as 0.
- **The blink is two fixed colours, never `--accent`.** `AccentPicker` builds the hero gradient from any hue the visitor picks, and a warning in that same hue disappears into its own background — the reason chart series colours are fixed too. `prefers-reduced-motion` stops the animation and keeps the box.
- **`fetchNotices` dedupes in flight**, because the landing page now reads the table twice in the same tick (the board and this). The entry is dropped as soon as it settles, so it is a dedupe and not a cache — nothing is ever served stale.

#### Portal messages — the dialog the office opens in front of somebody

The Notices tab has two sub-tabs. **Notice Board** is everything above: posted, and it waits to be read. **Portal Message** (`Notices/DirectMessage.jsx`, `src/lib/portalMessages.js` for the IO, `src/lib/portalMessageAlerts.js` for what counts as unread, `PortalMessage/` for the dialog) is the other thing the office needs: one paragraph that opens as a modal in front of students, teachers, or both, the next time they open their portal. Three radio buttons, a box, Send — and Delete on the list, like a notice.

`portal_messages` is a **separate table from `notices` on purpose** — see `supabase_portal_messages.sql`. A notice has a category, an attachment, a public board and a life of months; this has one audience, one paragraph, and it is finished the moment it has been read. Folding it in would mean a `popup` flag on a table where every other row is not one, and a public board that has to remember to filter it out.

- **'teachers' is genuinely private; 'students' is not private in the same sense, and the screen says so.** Teachers and admins are real Auth accounts, so `authenticated` is exactly the staff. Students have no account — every student-portal request is `anon`, the same role the public website uses — so the database cannot tell a girl's portal from a stranger's browser. A student message is off every public screen but is not secret, the same posture as `students_select` being open to anon and the reports bucket being public. Nothing about one named girl belongs in one.
- **Writing is gated on `admin_can_notices()`** — the same function and the same `notices` permission as the board, so no new `PERMISSION_KEYS` entry and nothing else in the RLS changed. Teachers cannot send one: a dialog in front of every student in the college is the office's to open.
- **Only "Got it" marks a message read.** Escape and a click outside close it for now and it opens again next sign-in — the opposite of the usual modal convention, and deliberate, because this is the one thing on screen she cannot go back and find later. Same principle as Cancel being the answer a stray Back press lands on in `BackGuard`.
- **`SHOW_FOR_DAYS` (30) is what stops a new phone being ambushed.** Read-state is per browser per viewer in `localStorage` — there is no read-receipt table and there cannot be a useful one, for the `lmsAlerts.js` reason — so to a browser that has never seen them, every message ever sent is unread. Past the window a message opens for nobody, and the admin's list labels it, because a row that has gone quiet must never look like one that is still working.
- **The deciding half imports nothing.** `portalMessageAlerts.js` holds the date window, the unread set difference and the storage, so all of it is drivable from plain Node; `portalMessages.js` re-exports it so a screen has one import. Both writes ask for their rows back and treat zero as failure (`WRITE_BLOCKED_HINT`), and a missing table (`42P01`) is reported as "run the SQL file" rather than as "no messages yet".

There is deliberately **no WhatsApp forward here.** It was removed: a notice already reaches every student through the portal tab and the public board the moment it is posted, and click-to-chat cannot actually send — it opened one chat per student for the admin to press Send in, thirty times, to deliver what the portal had already delivered. Bulk WhatsApp remains where the message is genuinely per-girl and time-critical (`MarkAttendance`'s absence reminders, the report and salary sends).

### Uploads — every bucket write goes through one file

`src/lib/uploads.js` is the only thing that decides what may be uploaded and how big it is allowed to be. All eight upload sites go through it: the admission form (photo + five documents), a fee proof, both profile-picture paths in `StudentsList`, a document on `StudentDetail`, an assignment question, a student's submission, and LMS material. Same arrangement as `whatsapp.js` being the only place that builds a chat link — a second copy of these numbers would drift within a term.

It exists because the college is on Supabase's free 1 GB and was spending it carelessly: a B-Form photographed on a phone arrives at 4–8 MB, there are five documents per applicant, and the admission form uploaded them exactly as the camera wrote them, with **no size limit on documents at all**. Around forty applications filled the whole quota. Redrawing that scan at 2000px costs nothing a reader can see and takes it to roughly 250 kB.

Four rules, and each one is a way this goes wrong:

- **The cap is measured after compression, never before.** Refusing an 8 MB camera photo at the file picker turns away a file that was about to become 250 kB, and the mother filling in the form has no way to shrink it herself. Only `SOURCE_IMAGE_LIMIT` (25 MB, too big to decode without locking a cheap phone) is refused up front. This is why the old 2 MB / 5 MB checks at the pickers are gone rather than merely moved.
- **Two halves, and they are used at different moments.** `selectionError(file, kind)` is synchronous, for a picker's `onChange`, and says no only to what compression could not have rescued — an oversized *image* is deliberately not an error there. `prepareUpload(file, kind)` is async and belongs immediately before the `storage.upload` call, where every screen already has a spinner running.
- **If it cannot compress, it hands the original back.** A PDF, a HEIC on a browser that cannot decode one, a canvas that failed: the file goes up as it came and only the cap applies. It never throws, so no upload can fail because of it. An uncompressible file over its cap is refused with its real size rather than silently uploaded.
- **Whichever is smaller wins.** Re-encoding an already-optimised JPEG can make it bigger, so the result is compared against the original and the original is kept when it was already better. `compressed: false` then, and callers that store a filename must use `ready.file.name` — a compressed scan is re-encoded as `.jpg` and labelling it `.png` misnames the student's download.

`UPLOAD_KINDS` holds the four kinds and their ceilings — `photo` (1200px, 2 MB), `document` (2000px, 5 MB), `submission` (2000px, 10 MB), `material` (2000px, 20 MB). The canvas fills white before drawing, because JPEG has no transparency and a PNG scan with a clear corner would otherwise come out black, and it decodes with `imageOrientation: "from-image"`, because a phone writes rotation into EXIF and a canvas that ignores it saves every portrait sideways.

It **imports nothing** — same discipline as `session.js`. It does reach the DOM for the canvas, so it cannot be driven from Node end to end, but every DOM path is guarded and falls back, which is what let the caps and the scale maths be exercised from plain Node against a stubbed canvas.

This is deliberately *only* the compression half of the storage problem. Two things it does not address, both still open: **nothing is ever deleted** (there is no `storage.remove()` anywhere — a superseded profile picture is a new file, since the path carries `Date.now()`, so the old one orphans forever), and report PDFs are stored rather than regenerated. Moving images to Cloudinary was considered and deferred; its free tier is 25 credits/month shared across storage *and* bandwidth, and PDF delivery is blocked by default on free accounts.

### Storage cleanup — the other half of the same problem

Compression stopped the bucket filling so fast; this stops it filling at all. The college is on Supabase's free **1 GB**, and until this existed **nothing in the app had ever called `storage.remove()`**. `removeMaterial` stamped `deleted_at` and left the file; a replaced profile picture became a *new* file because the path carries `Date.now()`; a rejected application kept all six documents. The failure that produces is an upload silently erroring in the middle of an admission.

`src/lib/storageCleanup.js` decides, `src/lib/storageSweep.js` acts, `StorageCleanup.jsx` is the screen. The split is the usual one: **the deciding half imports nothing**, because choosing which of a teacher's files to destroy is exactly the arithmetic that quietly goes wrong.

**Two halves that are not the same kind of decision, and must not be merged:**

- **The safe sweep runs by itself** once usage passes `SWEEP_ABOVE` (70%), with nobody asked, because nothing it deletes is visible to anybody: files whose LMS material was already soft-deleted, documents of rejected or deleted applications, and profile pictures no student row points at. It is triggered from `AdminPortal` on mount for a super admin — one RPC when usage is below the line, and that is the whole cost.
- **A teacher's live material is never swept automatically.** Oldest-first is what the college asked for and is what the screen offers, pre-ticked, but *oldest is a proxy for least valuable and it is often wrong* — the paper scheme goes up in the first week of the year and is wanted in the last. So it is a proposal an admin agrees to, and the warning strip in `AdminPortal` is how she finds out it is waiting.

**Four rules that are easy to break:**

- **Freeing stops at `SWEEP_DOWN_TO` (60%), not at 69.9%.** Without the gap a sweep would free one file, drop under the line, and run again on the next upload — deleting one more teacher's work every few minutes for the rest of the term.
- **`MIN_AGE_MS` (24h) is not a nicety.** A file is written to the bucket *before* the row that points at it, so anything newer than a day that looks like an orphan is a half-finished upload. `planSweep` and `orphansIn` both enforce it, and `planSweep` reports `skippedTooNew` rather than dropping them silently.
- **Never delete on the strength of a failed read.** The orphan sweep reasons from absence, and a `students` query that errored is indistinguishable from a college with no profile pictures. That read is checked and the sweep abandons instead of guessing.
- **Count what `remove()` returned, not what was asked for.** Same reasoning as `WRITE_BLOCKED_HINT`: a refused delete is a plain success, so freeing is measured by re-reading `storage_usage()` either side.

**Archiving keeps the record and takes only the file.** `file_url` is cleared and `file_archived_at` stamped; the title, notes, link and any YouTube video survive, and the student's LMS tab says the attachment was removed to save space and to ask her teacher for it again — a download button that has quietly vanished reads as a broken page.

Two leaks are now closed **at the source** as well, so the sweep only mops up the backlog: `removeMaterial` deletes the file with the row (best effort — the material is already off every screen, so a refused delete is a wasted byte, not a failure worth reporting), and replacing a profile picture deletes the one it replaced, after the row safely points at the new file.

`assignments` and `reports` are deliberately left alone and given no delete policy: a submission is a student's own work and the only copy of it, and a report PDF's link has already been sent to a parent on WhatsApp — deleting behind it breaks a message somebody may open months later. `STORAGE_QUOTA_BYTES` is the one number to change if the college ever leaves the free tier; Postgres cannot know the plan.

### Campus photos

`public/images/gallery/` is **generated output, not source** — never edit or add files there by hand. The camera originals live in `_original-photos/` (gitignored, ~93 MB) and `npm run optimize:images` derives, per photo, WebP at 320/640/1200/1600 plus one 1200px JPEG.

Two separate savings are at work, and both are easy to undo:

- **Format.** WebP over JPEG. The JPEG is a fallback only — `Photo.jsx` serves it through `<picture>` because `srcset` entries are not type-checked, so a browser that knows `srcset` but not WebP (Safari 13 and older) would otherwise pick a WebP and show nothing.
- **Width.** Nothing in the app picks a file; `srcset` offers all four and the browser chooses. That choice depends entirely on the `sizes` attribute, so **`sizes` is mandatory** — omit it and the browser assumes full-viewport and takes the largest file. The correct values per placement live in `PHOTO_SIZES`.

Always render campus photos through `Photo` (`src/components/Photo/Photo.jsx`), never a bare `<img>`. Its `.photo { display: contents }` is what keeps `<picture>` from becoming a layout box, so CSS written against the `<img>` keeps working.

The hero rails were the worst case before this: 420px boxes cycling all 25 photos at 1600px. They now paint the 640px WebP (~32 kB each), and `PhotoRail` warms up `photo.rail` — the same file it will display — rather than fetching a second copy.

Adding photos means: drop them in `_original-photos/`, re-run the script, bump `COUNT` in `src/lib/galleryImages.js`. `WIDTHS` there must match `WIDTHS` in `optimize-gallery.mjs`.

### Performance

Four rules carry it, and each one is easy to undo by accident. The numbers below are what `npm run build` must keep producing.

**Nothing loads before it is needed — including the database client.** `createClient` drags in the whole of supabase-js (auth-js 93 kB, realtime 29, phoenix 25, storage 26, postgrest 15 — **201 kB raw, 51 kB gzipped**) and it used to sit in the landing chunk, so a first-time visitor parsed all of it before the hero could paint, to run one REST select for the notice board. `notices.js` now `import()`s the client instead of importing it, and `vite.config.js` names a `supabase` group so the bundler cannot hoist it back. **The test is one line: `dist/index.html` must not carry a `modulepreload` for the supabase chunk.** Two things put that edge back and both were found this way — our own `supabaseClient.js` being inside the group (it must not be; it stays a 0.6 kB chunk of its own), and `DemoUi.jsx` importing the client statically, which counts even though `__DEMO__` folds the component away.

**Every screen behind a login is fetched when it is opened.** All three portals lazy-load their tabs, so signing in costs the shell and the first screen rather than the whole portal:

| | before | after |
|---|---|---|
| landing critical path | 458 kB (132 kB gz) | **258 kB (82 kB gz)** |
| student portal | 60 kB + 30 kB CSS | **18 kB + 7 kB CSS** |
| teacher portal | 14 kB + 8 kB CSS | **9 kB + 4 kB CSS** |
| admin portal | 258 kB + 89 kB CSS | **14 kB + 4 kB CSS** |

Each portal keeps **one loader per screen in a `TAB_LOADERS` map**, used by both `lazy()` and the warmer, because two `import()` calls with the same specifier resolve to the same module but writing the specifier twice is how they drift. `Sidebar` and `AdminSidebar` take `onItemHover` and call it on `mouseenter`/`focus` (desktop) and `touchstart` (the bottom bar and the phone dropdown), so a tab's code is usually already there when the click lands — the same trick `preload.js` plays with the portals themselves. One `<Suspense>` wraps all the branches, not one each: only one tab is ever on screen.

**No queries inside a `.map()`.** Use PostgREST embeds. `FeeVerification.fetchUnpaidFees` used to run two lookups per fee row — 135 requests against a 67-row `fees` table, growing with every student — and is now a single embedded query joining `students!inner` and `payment_transactions`. `fetchPending` and `fetchAll` follow the same shape. Sums like a fee's paid amount are derived in JS from the embedded rows.

**The heavy libraries are `import()`ed inside the handler that needs them**, never at module top level: jsPDF (~400 kB) in `reportPdf.js` / `payslipPdf.js`, JSZip (96 kB) in `buildReportsZip` and `xlsx.js`, the xlsx reader in `TestAlert`. A static import of any of them folds it into a portal chunk for everyone who never downloads a file.

**A module shared by two lazy chunks is hoisted into their common parent, which is the entry.** That is how `payroll.js` — the whole salary calculation, imported by the admin's Teachers & Staff chunk and by the teacher's My Salary chunk, and read by nothing on the landing page — came to be downloaded and parsed by every first-time visitor to the college's home page. Naming it as its own `advancedChunks` group moved 4.6 kB off the landing chunk (43.5 kB → **38.9 kB**) into a 5.3 kB chunk the two portals pull in themselves. Worth checking for whenever a lib file starts being used by a second portal; `dist/index.html` must still show no `modulepreload` for supabase, and the new chunk must not gain one either.

Also worth keeping: `react` is its own chunk so a deploy of the college's own code does not invalidate 190 kB in every browser cache; `index.html` preconnects to the Supabase origin so the first query does not pay for DNS and TLS; and images below the fold carry `loading="lazy" decoding="async"`.

The honest remaining cost: the supabase chunk still downloads on every landing visit, because the notice board and the test alert both read that table. It arrives after first paint, in parallel with the images, rather than before it — which is the whole of the win. Removing it entirely would mean a second, hand-written REST path for one query, and a second thing for the demo client to imitate.

### The logo

`public/logo.png` and `public/favicon.png` are **generated**, like the gallery. The supplied artwork is a seal adrift in a large near-white sheet — the emblem covers about a seventh of the canvas and the file is 1 MB. `npm run optimize:logo` crops to the ink and writes 256px and 180px versions (27 kB and 15 kB); the source stays in the gitignored `_original-photos/logo-original.png`. Sharp's `.trim()` is no use here because the backdrop carries a faint radial gradient, so the script finds the bounding box of genuinely dark pixels instead.

`Logo` (`src/components/Logo/Logo.jsx`) is the only thing that references the file — navbar, footer, login card and both portal sidebars all go through it. The wrappers around it (`.navbar__logo`, `.footer__logo`, `.login__logo`) no longer paint an accent background; the image fills the circle.

### Styling

Component-scoped CSS files sit next to their JSX (`ComponentName/ComponentName.css`) with BEM-ish `block__element--modifier` class names prefixed per component. Theming is CSS custom properties in `src/styles/themes.css` switched by `data-theme` on `<html>` — four themes: `light`, `dark`, `soft`, `academic`, persisted to `localStorage["cmgc-theme"]`. Use the `--bg`/`--text`/`--card`/`--border`/`--accent` variables rather than hardcoded colors so all four themes keep working.

On top of that, `AccentPicker` (the rainbow slider in the navbar) lets a visitor pick any hue. `src/lib/accent.js` turns that hue into inline custom properties on `<html>` — inline wins over the `[data-theme]` rules — overriding only `--accent`, `--accent-hover`, `--hero-from` and `--hero-to`. Backgrounds and text are deliberately never touched, which is what makes every hue safe. Saturation and lightness are chosen per theme and then corrected by luminance: hues darken until white text reads on them, and the dark theme searches for the lightness that best serves both white button text and its near-black background. Stored as a number in `localStorage["cmgc-accent"]`; absent means "use the theme's own accent", which is the default state and the exact look the site had before.

### The demo build

**Paused since August 2026 — do not mirror new work into it.** A feature is
finished when it works in the real app; it is no longer part of the job to teach
`demoClient.js` the queries it makes or to seed `demoData.js` with rows for it.
That mirroring is why almost every feature commit shows up twice in
`git log -- src/demo`, and it was costing more than the demo returned. The
deployed demo stays up and stays as it is; its Netlify site has its builds
stopped, because a demo that kept rebuilding from a frozen `src/demo` would
eventually deploy a broken screen instead of an old one. `DEMO.md` carries the
switch and how to restart it.

**What is still binding:** the folder stays in the repository and the fold-away
checks below are still the rule. `__DEMO__` folding to a literal `false` is what
keeps every byte of `src/demo` out of the real bundle, and that is a property of
the *production* build — it has nothing to do with whether the demo is being
maintained, and it breaks in exactly the same silent way if `supabaseClient.js`
or `vite.config.js` is touched carelessly. Run them after any such change.

`src/demo/` is a second database, not a second app. `vite.config.js` defines the
build-time constant `__DEMO__` (true only under `--mode demo`), `supabaseClient.js`
branches on it, and the app above that line does not know the difference. User-facing
notes are in `DEMO.md`; what matters here:

- **`__DEMO__` is a `define`, not an `import.meta.env` read, and that is the whole
  safety mechanism.** It folds to a literal `false` in a normal build, so Rollup
  removes the branch and then the entire `src/demo` folder. Both halves of that were
  measured: an `import.meta.env.VITE_DEMO === "true"` comparison survives as a runtime
  property lookup **even with the variable set in `.env.production`**, and left 4.4 kB
  of the demo login panel and banner in the real bundle. **The check is a build:**
  `npm run build` must keep the landing bundle at ~423 kB and the stylesheet at
  19.4 kB, and `grep demo-banner dist/assets/index-*.js` must find nothing.
- **This Vite does not apply `define` on the dev server**, so a bare `__DEMO__` is an
  undefined global there and *both* `npm run dev` and `npm run dev:demo` would throw
  before painting. The tiny `cmgc-demo-flag` plugin in `vite.config.js` (`apply: 'serve'`)
  injects `window.__DEMO__` into the HTML for dev only; the build never needs it.
- **Nothing in `src/demo` may run at import time.** `demoClient.js` builds the
  database inside `createDemoClient()` for exactly this reason — a `buildDemoDatabase()`
  call at module scope is a side effect Rollup must preserve, and the folder stops
  being removable.
- **Demo styles are a string inside `DemoUi.jsx`, not a `.css` file.** A CSS import
  is a side effect too; an earlier version leaked 1.8 kB of demo styling into the
  production stylesheet, same hash in both builds.
- `demoClient.js` implements the slice of PostgREST the app actually uses — measured
  from the source, not guessed. That includes two-level embeds
  (`payment_transactions → fees → students`), filters that target an embedded table
  (`.is("students.deleted_at", null)`), `!inner` dropping the parent row, `count/head`,
  and `.single()` returning `PGRST116` when nothing matches, which is what the student
  login reads as "wrong password".
- It also patches `window.fetch` for `/api/admin/*` and `/api/teacher/*`. Those are
  `server.js` routes, not Supabase, and without them Manage Admins and Teachers would
  be the only screens in the demo that error.
- The seed is deterministic (fixed mulberry32) so every visitor sees the same college,
  and **every date is relative to today** so the demo does not go stale. Reports default
  to the month that just ended, so that month is seeded densely.
- No demo student has a `profile_picture_url`. The campus photos are of real girls and
  must never be attached to invented records.

### Env vars

`.env` (gitignored) holds `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Only `VITE_`-prefixed vars reach the browser; `SUPABASE_SERVICE_ROLE_KEY` and any SMTP/Twilio values are server-only and must never gain a `VITE_` prefix.

### Notes

- Some comments in the code are in Roman Urdu; that's normal here.
