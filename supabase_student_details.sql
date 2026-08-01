-- CMGC — Full student record (WhatsApp, contact, family, matric, documents)
-- Paste this WHOLE file into Supabase Dashboard -> SQL Editor and press Run.
-- Safe to run more than once.
--
-- Approving an application only copied name, father, B-form, program, phone and
-- year onto the student — the other 29 fields the applicant filled in were left
-- behind on the application row and never seen again. Most immediately, her
-- WhatsApp number was lost, which is why the admin portal could only ever show
-- a landline-style phone that WhatsApp may not even be on.
--
-- These columns give the student record the same shape as the application, so
-- the admin can view and edit everything in one place — and so a student added
-- by hand can carry the same detail as one enrolled from a form.


-- ============================================================
-- 1. Contact
-- ============================================================
alter table students add column if not exists whatsapp text;
alter table students add column if not exists phone2   text;
alter table students add column if not exists email    text;
alter table students add column if not exists address  text;

comment on column students.whatsapp is
  'WhatsApp number, copied from the application. Messages prefer this over `phone`.';


-- ============================================================
-- 2. Personal & family
-- ============================================================
alter table students add column if not exists dob                   date;
alter table students add column if not exists father_cnic           text;
alter table students add column if not exists nationality           text;
alter table students add column if not exists religion              text;
alter table students add column if not exists orphan                boolean;
alter table students add column if not exists father_occupation     text;
alter table students add column if not exists monthly_income        numeric;
alter table students add column if not exists family_members        integer;
alter table students add column if not exists financial_assistance  boolean;


-- ============================================================
-- 3. Matric / SSC record
-- ============================================================
alter table students add column if not exists ssc_roll_no            text;
alter table students add column if not exists ssc_registration_no    text;
alter table students add column if not exists matric_marks_obtained  numeric;
alter table students add column if not exists matric_total_marks     numeric;
alter table students add column if not exists matric_percentage      numeric;
alter table students add column if not exists board                  text;
alter table students add column if not exists student_group          text;


-- ============================================================
-- 4. Documents
-- ============================================================
-- The photo already lives in students.profile_picture_url; these are the rest.
alter table students add column if not exists bform_doc_url            text;
alter table students add column if not exists father_id_doc_url        text;
alter table students add column if not exists marksheet_url            text;
alter table students add column if not exists noc_url                  text;
alter table students add column if not exists verified_marksheet_url   text;


-- ============================================================
-- 5. Backfill from the applications they were enrolled from
-- ============================================================
-- students.cnic holds the applicant's B-form, which is the only link between the
-- two tables. This recovers the detail for everyone already enrolled. Existing
-- values are never overwritten — coalesce keeps whatever is already on the
-- student row.

update students s
   set whatsapp              = coalesce(s.whatsapp, a.whatsapp),
       phone2                = coalesce(s.phone2, a.phone2),
       email                 = coalesce(s.email, a.email),
       address               = coalesce(s.address, a.address),
       dob                   = coalesce(s.dob, a.dob),
       father_cnic           = coalesce(s.father_cnic, a.father_cnic),
       nationality           = coalesce(s.nationality, a.nationality),
       religion              = coalesce(s.religion, a.religion),
       orphan                = coalesce(s.orphan, a.orphan),
       father_occupation     = coalesce(s.father_occupation, a.father_occupation),
       monthly_income        = coalesce(s.monthly_income, a.monthly_income),
       family_members        = coalesce(s.family_members, a.family_members),
       financial_assistance  = coalesce(s.financial_assistance, a.financial_assistance),
       ssc_roll_no           = coalesce(s.ssc_roll_no, a.ssc_roll_no),
       ssc_registration_no   = coalesce(s.ssc_registration_no, a.ssc_registration_no),
       matric_marks_obtained = coalesce(s.matric_marks_obtained, a.matric_marks_obtained),
       matric_total_marks    = coalesce(s.matric_total_marks, a.matric_total_marks),
       matric_percentage     = coalesce(s.matric_percentage, a.matric_percentage),
       board                 = coalesce(s.board, a.board),
       student_group         = coalesce(s.student_group, a.student_group),
       bform_doc_url         = coalesce(s.bform_doc_url, a.bform_doc_url),
       father_id_doc_url     = coalesce(s.father_id_doc_url, a.father_id_doc_url),
       marksheet_url         = coalesce(s.marksheet_url, a.marksheet_url),
       noc_url               = coalesce(s.noc_url, a.noc_url),
       verified_marksheet_url = coalesce(s.verified_marksheet_url, a.verified_marksheet_url)
  from applications a
 where a.bform = s.cnic
   and s.cnic is not null;

-- If she has no WhatsApp on record, fall back to her phone: better to message
-- the number we have than none at all. The admin can correct it from the portal.
update students
   set whatsapp = phone
 where coalesce(whatsapp, '') = ''
   and coalesce(phone, '') <> '';


-- ============================================================
-- Verify (run separately, after the above)
-- ============================================================
-- select roll_no, name, phone, whatsapp, email, board, marksheet_url is not null as has_marksheet
--   from students where deleted_at is null order by name;
