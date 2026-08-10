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
2. **`server.js`** — a small Express service holding the two things the browser must not: the Supabase **service role key** (creating/deleting sub-admin and teacher auth users) and SMTP/Twilio credentials (sending student credentials). Frontend reaches it via `VITE_API_URL` (default `http://localhost:3001`). Every `/api/admin/*` and `/api/teacher/*` route re-verifies the caller's Supabase access token server-side — `requireSuperAdmin` for admin routes, `requireTeacherManager` (super admin, or the `teachers` permission) for teacher routes. Never trust a client-supplied role. Because teacher accounts are auth users, **the Teachers tab needs `node server.js` running**, exactly like Manage Admins does.

### Navigation is state, not routes

There is no router. `src/App.jsx` early-returns `<Portal>` or `<AdmissionPage>` based on boolean state; `Portal.jsx` early-returns `<LoginPage>` or `<AdminPortal>` based on login/role state; each portal renders its tab from an `active` string. Adding a "page" means adding a state branch, not a route. **URLs never change**, so deep links are not supported by design — and must not be added casually, because state is lost on reload and an address that reloads to the wrong screen is worse than one that never claimed anything.

**The browser's Back button is supported, and `src/lib/backStack.js` is the whole of it.** One press walks back one screen inside the site; a press with nothing left to walk back to asks before leaving. It works without URLs because the browser only ever holds **one** guard entry (`arm()` keeps a marked entry above the one the visitor arrived on, so a back press fires `popstate` instead of unloading), while the real record of where she is lives in the module's own stack of undo steps.

Four rules, and breaking any one of them makes Back do nothing or do too much:

- **Whoever navigates forward calls `pushStep`**, at the click, so the closure captures the screen being left. `useTabHistory(active, setActive)` is that wrapper for a portal's tabs — pass its result as `setActive` and the whole nav follows. The undo sets state directly, so returning never pushes.
- **Whoever navigates backward in the UI calls `truncate(token)`.** A Logout or a "Back to Website" button collapses several levels at once; the dead steps above would otherwise sit there and swallow presses. `App` holds the tokens for the portal and the admission form, and `onExit` truncating from the portal down is what also clears the login and tab steps.
- **A step with `confirm` asks first** — used only for signing out of a portal, where a stray press costs an admin her Supabase session. Answering "no" pushes the step back.
- **`BackGuard` is rendered outside every screen branch in `App`**, in all three returns. It is what installs the guard, so unmounting it disarms the back button.

`installBackGuard()` is deliberately callable without React: the stack machine is the easy part to get wrong, and that seam is what let it be driven from plain Node against a stubbed `window` — the same reason `reportPdf.js` imports nothing that reaches Supabase.

### Auth: two entirely separate mechanisms, three roles

- **Students/parents** — no Supabase Auth at all. `LoginPage` queries the `students` table for a matching `roll_no` + plaintext `password` column and hands the whole row down as `studentData`. Session lives only in React state (lost on reload).
- **Admins** — real Supabase Auth (`signInWithPassword`), then `fetchAdminProfile()` loads their `admin_profiles` row. No profile row = no admin access.
- **Teachers** — the same Supabase Auth mechanism as admins: sign in with email + password, then `fetchTeacherProfile()` loads the `teachers` row matching `user_id`. No row (or `is_active: false`) = signed straight back out. `teachers` holds no password column; only the `students` table still uses the plaintext-password login.

### Admin permissions model

`src/lib/adminAuth.js` owns `PERMISSION_KEYS` (`students`, `attendance`, `results`, `fee`, `notices`, `lms`, `teachers`, `reports`). It re-exports `PROGRAMS`, which is **derived from `src/lib/academics.js`** — see below. These string values must match the DB and RLS policies exactly.

- `is_super_admin: true` → everything, plus the "Manage Admins" tab.
- Otherwise `permissions[]` gates which tabs render (`AdminSidebar` filters nav, `AdminPortal` guards the render), and `allowed_programs[]` scopes which students they can touch. **Empty `allowed_programs` means all programs, not none** — `allowedProgramsFor()` returns `[]` for super admins too, and components treat `[]` as unrestricted.
- The UI gate is cosmetic; the real enforcement is RLS policies on `students`/`attendance`/`results` documented in `SUPABASE_ADMIN_ROLES.md`. Changing a permission key or program name means updating both places.

**A write RLS refuses does not return an error.** PostgREST answers an `update`/`delete` that matches no policy-visible row with a plain success and zero rows — `error` is `null`. Inserts are the exception; they raise `42501`. So any update or delete that matters must ask for the rows back (`.select("id")`) and treat an empty array as failure, otherwise the UI reports "saved" while the database ignored it. `WRITE_BLOCKED_HINT` in `adminAuth.js` is the shared message; the two causes are an expired admin session (the request went out as `anon`) and a sub-admin reaching outside her `allowed_programs`.

### Groups and subject combinations

`src/lib/academics.js` defines every group as a list of **elective combinations**, and everything else is derived from it: `PROGRAMS` is its keys, `SUBJECTS[group]` is the union of that group's electives plus `COMPULSORY_SUBJECTS`. Adding a group means editing `GROUP_COMBINATIONS` only — the admission form, admin dropdowns, attendance, results and class tests all pick it up. It needs no SQL: `students.program`, `admin_profiles.allowed_programs` and `teachers.programs` are unconstrained text and the RLS policies compare by value.

Most groups have a single combination. **FA-IT (2 options) and Humanities (3) let the applicant choose**, and `groupHasChoice()` is what drives that branch in `AdmissionPage`. The pick is stored as a readable string in `applications.subject_combination`, then copied to `students.subject_combination` on approval (`supabase_fa_it_group.sql`).

Note the asymmetry this creates: marks entry (`EnterResults`, `ClassTestEntry`) offers the group's **whole** subject list, not one student's chosen three, because a teacher records a subject across the group rather than per student. `subject_combination` is currently a record of what she opted for, not a filter.

### Supabase schema (no migrations in-repo)

Schema changes are hand-run SQL documented in markdown at the repo root, and applied manually via the Supabase dashboard. When you change the data model, add/update the corresponding doc. The teachers/class-tests migration additionally ships as a runnable `supabase_teachers_migration.sql` — the markdown explains it, the `.sql` file is what gets pasted, so keep them in sync if you touch either.

- `SUPABASE_ADMIN_ROLES.md` — `admin_profiles`, `is_super_admin()`, all RLS policies (also records a known open issue: `students_delete` is still scoped to `anon`).
- `SUPABASE_CHANGES.md` — `students.profile_picture_url` + `student-profiles` storage bucket.
- `SUPABASE_FEE_ADMIN_ENTRY.md` — `payment_transactions.recorded_by`.
- `supabase_fee_plans.sql` — the `fee_plans` table, `fees.label`/`fees.year_of_study`, and the seeded plans for all 12 (year, group) pairs.
- `supabase_fa_it_group.sql` — `subject_combination` on `applications` and `students`.
- `supabase_lms.sql` — `lms_materials` plus the `lms-materials` storage bucket (created by hand in the dashboard). Also back-fills the new `lms` right onto every teacher who already holds `class_tests`.
- `supabase_profile_edit_requests.sql` — `profile_edit_requests`, plus the only write path students have. See "Student self-service edits" below; the column-level `grant update (...) on students to anon` in there is the hard ceiling on what a student can ever change, and `STUDENT_EDITABLE` in `src/lib/profileEdit.js` must mirror it.
- `supabase_bform_unique.sql` — partial unique indexes making one B-Form mean one girl: `applications_bform_unique` (exempts soft-deleted and `Rejected` rows so a rejected applicant may re-apply) and `students_cnic_unique`. Both index `regexp_replace(…, '[^0-9]', '', 'g')`, so a number typed with or without dashes is the same number.
- `supabase_student_details.sql` — the 25 columns that bring `students` up to parity with `applications` (`whatsapp`, contact, personal, family/finance, matric record, and the five document URLs), plus a backfill joining `applications a` on `a.bform = s.cnic` with `coalesce` so nothing already set is overwritten, and a `whatsapp = phone` fallback.
- `supabase_monthly_reports.sql` — the `reports` storage bucket and the `report_log` table behind Monthly Reports. Adds no columns to anything: the report is assembled in the browser from tables that already exist. Note the security trade recorded at the bottom of that file — report PDFs sit in a public bucket because the parent opening the link has no login.
- `SUPABASE_TEACHERS_CLASS_TESTS.md` — `teachers.user_id`/`rights[]`/`subjects[]`, `class_tests` + `class_test_marks`, the `is_staff()` / `teacher_can()` helpers and every policy built on them. Note the `teacher read students` policy is mandatory: `students_select` is scoped to `anon`, and admins only read students through their own write policy, so without it a teacher's portal shows an empty roster everywhere.

- `SUPABASE_STAFF_PAYROLL.md` / `supabase_staff_payroll.sql` — payroll for everyone the college pays: `teachers.employment_type`/`monthly_salary`/`per_day_salary`/`whatsapp`, the `staff` table (non-teaching), plus `staff_attendance`, `college_holidays` and `staff_salaries`. The markdown explains it, the `.sql` is what gets pasted — keep them in sync, same arrangement as the teachers migration. Section 0 of the `.sql` renames the tables from an earlier teacher-only version of this migration, so it is safe on a database that already ran that one.

Tables in use: `students`, `admin_profiles`, `teachers`, `staff`, `applications`, `attendance`, `results`, `class_tests`, `class_test_marks`, `assignments`, `assignment_submissions`, `fees`, `payment_transactions`, `notices`, `report_log`, `staff_attendance`, `college_holidays`, `staff_salaries`. Storage buckets: `student-profiles`, `admission-documents`, `assignments`, `reports` (all public).

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

### LMS

`lms_materials` is one row per thing a teacher or admin publishes for a subject — a recorded lecture, an old paper, the paper scheme, notes, a link. `LmsManage` writes them — shared by both portals like `ClassTestEntry`, taking a `teacher` for her own subjects or `teacher={null}` plus `allowedPrograms` for the admin's full-range view — `Lms` (student portal) reads them, and `src/lib/lms.js` holds everything the two must agree on: `LMS_CATEGORIES` (the `id` values are stored, so they are not free to rename), and the YouTube helpers.

A row carries any combination of written text, a link and a file, so the same screen covers "watch this lecture" and "here is what to revise". Groups work exactly like `class_tests` — `program` holds a single group or the `"All Programs"` literal, `programs[]` holds what it actually covers, and the student query filters on `programs`.

`parseYouTube()` accepts watch URLs, `youtu.be`, playlists, shorts, embeds and a video-inside-a-playlist; anything else returns null and the student gets a plain "Open link" button instead of a player. Playback is `youtube-nocookie.com`, and every video also offers "Open on YouTube" — a playlist embed keeps the playlist.

Unlike the `class_tests` policies, which settle for `is_staff()`, the write policy checks entitlement to **every** group the row covers — `bool_and(teacher_can('lms', p))` for a teacher, `admin_can_lms()` (the `lms` permission plus `programs <@ allowed_programs`) for an admin. A combined item is therefore not a way to reach a group you were never assigned.

### Teachers & class tests

`teachers.rights[]` gates the teacher portal exactly like `admin_profiles.permissions[]` gates the admin one — keys are defined in `src/lib/teacherAuth.js` (`class_tests`, `view_students`, `attendance`, `results`). `teachers.subjects[]` and `teachers.programs[]` scope her further, and **empty means unrestricted**, same convention as `allowed_programs`. Unlike the admin UI gate, these are backed by RLS: `teacher_can(right, program)` is what the `attendance`/`results` teacher policies check.

A `teachers` row can exist with `user_id` null — a recorded teacher who has no login yet. The Teachers tab shows "Create Login" for those, which posts to `/api/teacher/create` with a `teacherId` to attach an auth user to the existing row rather than inserting a new one.

Class tests are two tables on purpose: `class_tests` is one row per test conducted, `class_test_marks` one row per student per test with a `unique (class_test_id, student_id)` constraint that `ClassTestEntry` upserts against. That shape is what lets each subject carry a different number of tests — the student's `ClassTests` tab groups marks by subject and renders each subject's own horizontal strip of tests.

A test can span groups: picking `"All Programs"` stores that literal in `class_tests.program` and the concrete groups it covered in `class_tests.programs[]`. Always build the roster from `programs[]`, falling back to `[program]` — reading `program` alone silently returns nobody for a combined test.

`ClassTestEntry` is shared: pass a `teacher` and it locks to her subjects/programs and stamps her id on new tests; pass `teacher={null}` plus `teacherOptions` and it becomes the admin's full-range view.

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

Four rules that are easy to break:

- **An unmarked day is not an absence.** It is counted as `unmarkedDays` and shown, but never deducted. Reading "nobody filled the register" as "they didn't come" takes money off someone who was at work — the same principle as `notMarked` never printing as 0 in a test report.
- **Saving the register is two upserts, not one.** A teacher row conflicts on `(teacher_id, date)` and a staff row on `(staff_id, date)`, and PostgREST takes one conflict target per request. `DailyRegister.save()` splits the batch for exactly this reason; merging it silently drops one side.
- **Everything on the Salary screen is recomputed from `staff_attendance` on open.** `staff_salaries` stores only what cannot be derived — `bonus`, `other_deduction`, `notes` — plus the payment record and a snapshot of what was shown. Correcting an attendance mark therefore corrects the payslip immediately.
- **`status` is derived and written back** from `paid_amount` against `net_payable`, exactly like a fee's. `salaryStatusFor()` is the only definition; do not re-derive it in a component.

**The teacher portal has a "My Salary" tab** (`src/components/TeacherSalary/TeacherSalary.jsx`), so a teacher can see her own attendance, the working behind her figure, her payment history and download her payslip. Three things about it:

- **It is not in `NAV_ITEMS` and is never filtered by `hasTeacherRight`.** A right is something the admin grants; her own pay is not the admin's to withhold. It is appended to the nav unconditionally, and it is checked before the "no duties assigned" branch so a teacher with no rights yet still lands on a working portal.
- **It needed no new policy.** `staff_attendance_select` and `staff_salaries_select` already allow `is_this_teacher(teacher_id)`, so her queries return her rows and nobody else's — the database scopes this, not the UI.
- **It recomputes rather than reads.** Same `computeSalary()` on the same attendance rows as the admin sheet, so the slip she downloads cannot disagree with the sheet the office works from — neither of them stores the answer.

`src/lib/payslipPdf.js` renders the slip and follows both `reportPdf.js` rules: **jsPDF is `import()`ed inside the handler**, never at module top level (it is ~400 kB, and both the teacher portal and the admin portal statically import their tabs — a top-level import would put the PDF engine in both chunks for everyone who never downloads one), and it **reaches nothing that touches `supabaseClient`**, taking a finished `calc` so it can be driven from plain Node against fixtures. The admin's "Payslip" button on each salary card calls the identical function, so the office and the employee hand out the same document.

Three screens, all sub-tabs of Teachers & Staff and all gated by the existing `teachers` permission (no new `PERMISSION_KEYS` entry, so the RLS built on it is unchanged): `Teachers.jsx` (teaching roster, and it owns the `staff` fetch because payroll needs the same list), `AdminStaff/AdminStaff.jsx` (non-teaching roster — plain Supabase writes, no server round trip, since nobody in it has a login), and `StaffPayroll/StaffPayroll.jsx` (the daily register plus the monthly sheet). Writes go through `.select(...)` and treat zero rows as failure — a refused RLS write returns success, see `WRITE_BLOCKED_HINT`. Bulk WhatsApp is a **queue, not a loop**, like every other bulk send in the project. `buildSalaryMessage()` spells out the working rather than just the total, because a slip that only states a figure invites the argument it exists to prevent.

### Reports

The `reports` tab holds three screens, all gated by the `reports` permission and scoped by `allowed_programs` like every other admin screen.

- **Monthly Reports** — one PDF per girl for a month: attendance, class tests, assignments, fee position. Class tests only; this tab never touches `results`.
- **Exam Reports** — one PDF per girl for one term exam: its marksheet, plus the same attendance/assignments/fee context.
- **Test Reports** — one class test across a class: a result sheet with positions, grades and class statistics, then a page per girl to send home. `src/lib/testReport.js` owns it.

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

### WhatsApp

`src/lib/whatsapp.js` is the only place that builds a WhatsApp link — `StudentsList`, `MarkAttendance` and `FeeVerification` all go through it, and none of them keeps a local number normalizer.

- `whatsappNumberFor(person)` reads `whatsapp` first and falls back to `phone`. Never message `phone` directly: the two are often different numbers and the phone on file may have no WhatsApp on it.
- `whatsappUrl()` sends desktop straight to `web.whatsapp.com/send` and mobile to `wa.me`. `wa.me` on a laptop is a redirect hop that frequently lands on the "download WhatsApp" interstitial and loses the prefilled text — that is what made laptop sending unreliable.
- Bulk sending is a **queue, not a loop**. `window.open` fired repeatedly in one tick gets blocked after the first tab, and WhatsApp Web drops chats pushed at it in the same second. `MarkAttendance` holds a `waQueue` and opens one chat per click; `openWhatsAppQueue()` is the shared helper for the same pattern.

Click-to-chat can only pre-fill — a human must press Send. Actual automated delivery needs the WhatsApp Business API: `POST /api/send-credentials` in `server.js` (email via SMTP, WhatsApp via Twilio) is wired for it but `SMTP_*` / `TWILIO_*` are not set in `.env`, so the deep-link path is the one in use.

### Campus photos

`public/images/gallery/` is **generated output, not source** — never edit or add files there by hand. The camera originals live in `_original-photos/` (gitignored, ~93 MB) and `npm run optimize:images` derives, per photo, WebP at 320/640/1200/1600 plus one 1200px JPEG.

Two separate savings are at work, and both are easy to undo:

- **Format.** WebP over JPEG. The JPEG is a fallback only — `Photo.jsx` serves it through `<picture>` because `srcset` entries are not type-checked, so a browser that knows `srcset` but not WebP (Safari 13 and older) would otherwise pick a WebP and show nothing.
- **Width.** Nothing in the app picks a file; `srcset` offers all four and the browser chooses. That choice depends entirely on the `sizes` attribute, so **`sizes` is mandatory** — omit it and the browser assumes full-viewport and takes the largest file. The correct values per placement live in `PHOTO_SIZES`.

Always render campus photos through `Photo` (`src/components/Photo/Photo.jsx`), never a bare `<img>`. Its `.photo { display: contents }` is what keeps `<picture>` from becoming a layout box, so CSS written against the `<img>` keeps working.

The hero rails were the worst case before this: 420px boxes cycling all 25 photos at 1600px. They now paint the 640px WebP (~32 kB each), and `PhotoRail` warms up `photo.rail` — the same file it will display — rather than fetching a second copy.

Adding photos means: drop them in `_original-photos/`, re-run the script, bump `COUNT` in `src/lib/galleryImages.js`. `WIDTHS` there must match `WIDTHS` in `optimize-gallery.mjs`.

### Performance

Two rules carry most of it, and both are easy to undo by accident.

**Route-level code splitting.** `App.jsx` lazy-loads `Portal` and `AdmissionPage`; `Portal.jsx` lazy-loads `AdminPortal` and `TeacherPortal`. Before this the landing page shipped one 652 kB bundle containing every admin screen; it is now 419 kB with the rest fetched on demand, and the initial CSS dropped from 120 kB to 18 kB. A static `import` of any portal component from `App.jsx` silently folds it back into the landing bundle.

**No queries inside a `.map()`.** Use PostgREST embeds. `FeeVerification.fetchUnpaidFees` used to run two lookups per fee row — 135 requests against a 67-row `fees` table, growing with every student — and is now a single embedded query joining `students!inner` and `payment_transactions`. `fetchPending` and `fetchAll` follow the same shape. Sums like a fee's paid amount are derived in JS from the embedded rows.

Also worth keeping: `index.html` preconnects to the Supabase origin so the first query does not pay for DNS and TLS, and images below the fold carry `loading="lazy" decoding="async"`.

### The logo

`public/logo.png` and `public/favicon.png` are **generated**, like the gallery. The supplied artwork is a seal adrift in a large near-white sheet — the emblem covers about a seventh of the canvas and the file is 1 MB. `npm run optimize:logo` crops to the ink and writes 256px and 180px versions (27 kB and 15 kB); the source stays in the gitignored `_original-photos/logo-original.png`. Sharp's `.trim()` is no use here because the backdrop carries a faint radial gradient, so the script finds the bounding box of genuinely dark pixels instead.

`Logo` (`src/components/Logo/Logo.jsx`) is the only thing that references the file — navbar, footer, login card and both portal sidebars all go through it. The wrappers around it (`.navbar__logo`, `.footer__logo`, `.login__logo`) no longer paint an accent background; the image fills the circle.

### Styling

Component-scoped CSS files sit next to their JSX (`ComponentName/ComponentName.css`) with BEM-ish `block__element--modifier` class names prefixed per component. Theming is CSS custom properties in `src/styles/themes.css` switched by `data-theme` on `<html>` — four themes: `light`, `dark`, `soft`, `academic`, persisted to `localStorage["cmgc-theme"]`. Use the `--bg`/`--text`/`--card`/`--border`/`--accent` variables rather than hardcoded colors so all four themes keep working.

On top of that, `AccentPicker` (the rainbow slider in the navbar) lets a visitor pick any hue. `src/lib/accent.js` turns that hue into inline custom properties on `<html>` — inline wins over the `[data-theme]` rules — overriding only `--accent`, `--accent-hover`, `--hero-from` and `--hero-to`. Backgrounds and text are deliberately never touched, which is what makes every hue safe. Saturation and lightness are chosen per theme and then corrected by luminance: hues darken until white text reads on them, and the dark theme searches for the lightness that best serves both white button text and its near-black background. Stored as a number in `localStorage["cmgc-accent"]`; absent means "use the theme's own accent", which is the default state and the exact look the site had before.

### The demo build

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
