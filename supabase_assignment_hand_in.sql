-- CMGC — Assignments handed in by hand, in class
-- Paste this WHOLE file into Supabase Dashboard -> SQL Editor and press Run.
-- Safe to run more than once. Requires supabase_assignments.sql to have run first.
--
-- A student has two ways to hand in an assignment: upload it from her portal, or
-- show the teacher her work on paper in class. This flag records the second way,
-- so a girl who handed in on paper stops looking like one who handed in nothing.
-- Either side can set it: she can tick "I handed it in by hand in class" on her
-- portal, and the teacher can tick it against her name on the marks screen.
-- Marks and remarks work the same for both kinds of hand-in.

alter table assignment_submissions
  add column if not exists submitted_in_class boolean not null default false;

comment on column assignment_submissions.submitted_in_class is
  'True when the work was handed in on paper in class rather than uploaded. Set by the student or the teacher; marks apply either way.';

-- No RLS changes: the existing insert/update policies on assignment_submissions
-- already cover this column.
