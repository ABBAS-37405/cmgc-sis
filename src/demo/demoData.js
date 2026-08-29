/**
 * The demo college: one seeded, self-consistent year of records.
 *
 * Everything is generated rather than typed out, from a fixed seed, so the file
 * stays readable and every visitor sees exactly the same college — a demo whose
 * numbers move between two people looking at it is worse than no demo.
 *
 * Two rules the generator follows, and both matter more than they look:
 *
 * - **Dates are relative to today, never hardcoded.** A demo shown in six months
 *   must still open on a full month of attendance and a recent exam. Reports
 *   default to the month that just ended, so that month in particular is seeded
 *   densely.
 * - **Nothing here is a real person.** Names, numbers and B-Forms are invented,
 *   and no student carries a photograph — the campus photos in `public/images`
 *   are of real girls and must never be dressed up as fake records.
 */

import { PROGRAMS, YEARS, subjectsFor, combinationsFor, formatCombination, compulsoryFor } from "../lib/academics";
// Safe to import, unlike lib/feePlans below: payroll reaches nothing that touches
// the Supabase client, so there is no cycle back into the client being built.
import { computeSalary, salaryRowFor } from "../lib/payroll";

/* --------------------------------------------------------------- plumbing */

/** mulberry32 — small, fast, and identical on every machine. */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stable, uuid-shaped ids. They must look like real UUIDs because a monthly
 * report's storage path is built from one, and they must not change between
 * loads because the seeded rows reference each other by id.
 */
let counter = 0;
const uid = (tag) =>
  `${String(tag).padStart(8, "0").slice(0, 8)}-0000-4000-8000-${String((counter += 1)).padStart(12, "0")}`;

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const at = (d) => new Date(d).toISOString();

const today = () => new Date();
const daysAgo = (n) => {
  const d = today();
  d.setDate(d.getDate() - n);
  d.setHours(9, 30, 0, 0);
  return d;
};
const longDate = (d) => d.toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });

const pick = (rand, list) => list[Math.floor(rand() * list.length)];

/**
 * Does this seeded girl sit this subject.
 *
 * Deliberately a local string check rather than `takesSubject` from
 * `lib/studentSubjects.js`: importing that here puts it in the **production**
 * landing chunk — measured at **+686 bytes** — because `src/demo` is only
 * removed after Rollup has assigned modules to chunks. It is not a second
 * definition of the rule either; the seed writes an exact combination string on
 * every student, so this is the seed staying consistent with itself.
 */
const sitsSubject = (s, subject) =>
  compulsoryFor(s.year_of_study).includes(subject) ||
  (s.subject_combination || "").includes(subject);

/**
 * A real elective combination for this group, spread across the ones it offers.
 *
 * Not `SUBJECTS[group].slice(0, 3)`, which happened to spell out combination one
 * and gave every Humanities girl the same three subjects — so a Civics class
 * test in the demo would find nobody, now that marks entry filters the roster by
 * who actually sits the subject. Deterministic like everything else here.
 */
const comboFor = (rand, group) => {
  const combos = combinationsFor(group);
  if (combos.length === 0) return null;
  return formatCombination(combos[Math.floor(rand() * combos.length)]);
};

const between = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

/**
 * Stand-in files. They are data URIs rather than `demo://…` so that every
 * "View proof" and "Download" button in the demo actually opens something —
 * a dead link in front of an audience reads as a broken feature.
 */
const DEMO_IMAGE =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="560">
      <rect width="100%" height="100%" fill="#eef2ff"/>
      <rect x="24" y="24" width="372" height="512" fill="#fff" stroke="#c7d2fe" stroke-width="2" rx="10"/>
      <text x="210" y="250" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#3730a3">Payment Receipt</text>
      <text x="210" y="290" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#6366f1">Sample image — demo data</text>
    </svg>`
  );

const DEMO_DOC = (title) =>
  "data:text/html;charset=utf-8," +
  encodeURIComponent(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<body style="font-family:system-ui;padding:48px;max-width:640px;margin:auto">` +
    `<h1>${title}</h1><p>This is a placeholder document in the CMGC demo. ` +
    `In the real portal this would be the file the teacher or student uploaded.</p></body>`
  );

/* ------------------------------------------------------------------- cast */

const FIRST_NAMES = [
  "Ayesha", "Fatima", "Zainab", "Maryam", "Khadija", "Hafsa", "Amna", "Sana",
  "Iqra", "Rabia", "Noor", "Areeba", "Laiba", "Eman", "Hira", "Mahnoor",
  "Sidra", "Anum", "Bisma", "Kinza", "Alishba", "Zoya", "Warda", "Nimra",
  "Sumaiya", "Aiman", "Rimsha", "Tooba", "Javeria", "Saba", "Kainat", "Momina",
  "Aleena", "Hooria", "Minahil", "Umm-e-Habiba", "Shanza", "Rida", "Duaa", "Sahar",
  "Fiza", "Neha", "Arooj", "Mehak", "Zunaira", "Ifra", "Haleema", "Sawera",
  "Ayat", "Nayab", "Barira", "Hania", "Aqsa", "Mishal", "Iman", "Zoha",
  "Anaya", "Emaan", "Rameen", "Manahil",
];

const FATHER_NAMES = [
  "Muhammad Aslam", "Abdul Rehman", "Muhammad Nawaz", "Ghulam Mustafa", "Tariq Mehmood",
  "Muhammad Ashraf", "Shahid Iqbal", "Rana Zahid", "Muhammad Younas", "Allah Ditta",
  "Malik Sarfraz", "Muhammad Ramzan", "Khalid Pervaiz", "Zulfiqar Ali", "Muhammad Akram",
  "Chaudhry Nazir", "Abdul Ghafoor", "Muhammad Ilyas", "Sajjad Hussain", "Riaz Ahmed",
];

const OCCUPATIONS = ["Shopkeeper", "Farmer", "Government Servant", "Driver", "Labourer", "Teacher", "Tailor", "Electrician"];
const BOARDS = ["BISE Lahore", "BISE Gujranwala", "BISE Sargodha", "BISE Faisalabad", "BISE Rawalpindi"];
const CITY_AREAS = ["Mohallah Islampura", "Chak No. 42", "Street 7, Gulshan Colony", "Near Jamia Masjid, Model Town", "Ward No. 5, Civil Lines"];

/* ------------------------------------------------------------ the builder */

/**
 * Builds the whole database. Called once at start-up and again by the Reset
 * button, which is why it returns a fresh object every time rather than
 * mutating a shared one.
 */
export function buildDemoDatabase() {
  counter = 0;
  const rand = makeRng(20260803);

  const db = {
    students: [], teachers: [], admin_profiles: [], applications: [],
    attendance: [], results: [], class_tests: [], class_test_marks: [],
    assignments: [], assignment_submissions: [], fees: [], payment_transactions: [],
    notices: [], portal_messages: [], lms_materials: [], profile_edit_requests: [], fee_plans: [],
    report_log: [], staff: [], staff_attendance: [], college_holidays: [], staff_salaries: [],
    expenses: [], teacher_login_passwords: [],
  };

  /* ------------------------------------------------------------- staff */

  // Both pay shapes are represented on purpose — a payroll screen showing only
  // Regular staff demonstrates half the feature.
  const teacherSeed = [
    { name: "Ayesha Siddiqa", email: "ayesha.teacher@cmgc.demo", subject: "Physics",
      subjects: ["Physics", "Chemistry"], programs: ["Pre-Engineering", "Pre-Medical"],
      rights: ["class_tests", "view_students", "attendance", "results", "lms"], qualification: "M.Phil Physics",
      employment_type: "Regular", monthly_salary: 48000 },
    { name: "Fatima Noor", email: "fatima.teacher@cmgc.demo", subject: "English",
      subjects: ["English", "Urdu", "Islamiat"], programs: [],
      rights: ["class_tests", "view_students", "lms"], qualification: "M.A English",
      employment_type: "Regular", monthly_salary: 36000 },
    { name: "Hina Tariq", email: "hina.teacher@cmgc.demo", subject: "Computer Science",
      subjects: ["Computer Science", "Mathematics"], programs: ["ICS", "General Science", "FA-IT"],
      rights: ["class_tests", "view_students", "attendance", "results", "lms"], qualification: "MCS",
      employment_type: "Visiting", per_day_salary: 1800 },
    // No user_id: a teacher on the register who has never been given a login.
    // The Teachers tab shows "Create Login" for exactly this row.
    { name: "Sadia Iqbal", email: null, subject: "Biology",
      subjects: ["Biology"], programs: ["Pre-Medical"],
      rights: ["class_tests"], qualification: "M.Sc Botany", noLogin: true,
      employment_type: "Visiting", per_day_salary: 1500 },
  ];

  // The vault a super admin reads on the Teachers tab. Only teachers who have a
  // login get one, and Sadia (no login) deliberately has none — the demo should
  // show both states, since a college always has a mix of them.
  const teacherPasswordSeed = ["ayesha2481", "fatima3907", "hina5162"];

  teacherSeed.forEach((t, i) => {
    // uid() advances a counter, so the id is taken once and reused. Calling it again
    // for the password row would file that password against a teacher who does not exist.
    const teacherId = uid(20 + i);
    if (!t.noLogin && teacherPasswordSeed[i]) {
      db.teacher_login_passwords.push({
        teacher_id: teacherId,
        password: teacherPasswordSeed[i],
        set_at: at(daysAgo(30 + i * 10)),
        set_by: null,
      });
    }
    db.teachers.push({
      id: teacherId,
      user_id: t.noLogin ? null : uid(120 + i),
      name: t.name,
      email: t.email,
      subject: t.subject,
      subjects: t.subjects,
      programs: t.programs,
      rights: t.rights,
      qualification: t.qualification,
      phone: `0300${between(rand, 1000000, 9999999)}`,
      whatsapp: null,
      employment_type: t.employment_type,
      monthly_salary: t.monthly_salary ?? null,
      per_day_salary: t.per_day_salary ?? null,
      joining_date: iso(daysAgo(400 + i * 60)),
      is_active: true,
      created_at: at(daysAgo(400)),
    });
  });

  // Non-teaching staff — a separate register, not `teachers` rows. Every
  // department is represented once so the payroll filter has something to filter,
  // and both pay shapes appear: salaried office staff, daily-wage support staff.
  const staffSeed = [
    { name: "Muhammad Aslam", designation: "Accountant", department: "Accounts",
      employment_type: "Regular", monthly_salary: 42000 },
    { name: "Nasreen Bibi", designation: "Office Clerk", department: "Administration",
      employment_type: "Regular", monthly_salary: 26000 },
    { name: "Abdul Rehman", designation: "Librarian", department: "Academic Support",
      employment_type: "Regular", monthly_salary: 24000 },
    { name: "Ghulam Murtaza", designation: "Security Guard", department: "Security",
      employment_type: "Regular", monthly_salary: 22000 },
    { name: "Allah Ditta", designation: "Peon (Naib Qasid)", department: "Maintenance",
      employment_type: "Visiting", per_day_salary: 900 },
    { name: "Sakina Bibi", designation: "Sweeper", department: "Maintenance",
      employment_type: "Visiting", per_day_salary: 750 },
    { name: "Muhammad Younas", designation: "Driver", department: "Transport",
      employment_type: "Regular", monthly_salary: 28000 },
  ];

  staffSeed.forEach((s, i) => {
    db.staff.push({
      id: uid(50 + i),
      name: s.name,
      father_name: pick(rand, FATHER_NAMES),
      cnic: `35202-${between(rand, 1000000, 9999999)}-${between(rand, 1, 9)}`,
      designation: s.designation,
      department: s.department,
      phone: `0301${between(rand, 1000000, 9999999)}`,
      whatsapp: null,
      address: pick(rand, CITY_AREAS),
      emergency_contact: null,
      employment_type: s.employment_type,
      monthly_salary: s.monthly_salary ?? null,
      per_day_salary: s.per_day_salary ?? null,
      joining_date: iso(daysAgo(between(rand, 200, 900))),
      is_active: true,
      notes: null,
      created_at: at(daysAgo(300)),
    });
  });

  db.admin_profiles.push(
    {
      id: uid(30), user_id: uid(130), email: "principal@cmgc.demo", name: "Principal (Super Admin)",
      is_super_admin: true, permissions: [], allowed_programs: [], created_at: at(daysAgo(500)), created_by: null,
    },
    {
      // A deliberately narrow account: it is the clearest way to show the
      // permission model in a presentation.
      id: uid(31), user_id: uid(131), email: "clerk@cmgc.demo", name: "Office Clerk (Limited)",
      is_super_admin: false,
      permissions: ["students", "attendance", "fee", "reports"],
      allowed_programs: ["Pre-Medical", "ICS"],
      created_at: at(daysAgo(200)), created_by: db.admin_profiles[0]?.id || null,
    }
  );

  /* ---------------------------------------------------------- fee plans */

  const planFor = (year) =>
    year === "1st Year"
      ? {
          admission_fee: 5000, monthly_fee: 2500, total_fee: 35000,
          installments: [
            { label: "1st Installment (4 months)", months: 4, due_month: null },
            { label: "2nd Installment (4 months)", months: 4, due_month: 12 },
            { label: "3rd Installment (4 months)", months: 4, due_month: 4 },
          ],
        }
      : {
          admission_fee: 3000, monthly_fee: 2800, total_fee: 25400,
          installments: [
            { label: "1st Installment (4 months)", months: 4, due_month: 9 },
            { label: "2nd Installment (4 months)", months: 4, due_month: 1 },
          ],
        };

  YEARS.forEach((year) => {
    PROGRAMS.forEach((program) => {
      db.fee_plans.push({ id: uid(40), year_of_study: year, program, ...planFor(year), updated_at: at(daysAgo(120)) });
    });
  });

  /* ----------------------------------------------------------- students */

  const PER_CLASS = 5;
  let nameIndex = 0;
  let rollNo = 0;
  const enrolYear = today().getFullYear();

  PROGRAMS.forEach((program) => {
    YEARS.forEach((year) => {
      for (let i = 0; i < PER_CLASS; i += 1) {
        const name = FIRST_NAMES[nameIndex % FIRST_NAMES.length];
        nameIndex += 1;
        const father = pick(rand, FATHER_NAMES);
        const cnicDigits = `3520${between(rand, 1000000, 9999999)}${between(rand, 100, 999)}`;
        const matricTotal = 1100;
        const matricObtained = between(rand, 620, 1010);
        // 2nd years enrolled a year earlier, which is what makes their fee
        // schedule land in different months from the 1st years'.
        const enrolledDaysAgo = year === "2nd Year" ? between(rand, 380, 420) : between(rand, 20, 90);

        db.students.push({
          id: uid(1),
          roll_no: `CMGC-${enrolYear}-${String((rollNo += 1)).padStart(4, "0")}`,
          name,
          father_name: father,
          cnic: `${cnicDigits.slice(0, 5)}-${cnicDigits.slice(5, 12)}-${cnicDigits.slice(12)}`,
          program,
          year_of_study: year,
          subject_combination: comboFor(rand, program),
          password: "cmgc123",
          phone: `030${between(rand, 10000000, 99999999)}`,
          whatsapp: `030${between(rand, 10000000, 99999999)}`,
          phone2: null,
          email: null,
          address: `${pick(rand, CITY_AREAS)}, Gujranwala`,
          dob: iso(new Date(enrolYear - (year === "2nd Year" ? 18 : 17), between(rand, 0, 11), between(rand, 1, 28))),
          father_cnic: `${cnicDigits.slice(0, 5)}-${between(rand, 1000000, 9999999)}-${between(rand, 1, 9)}`,
          nationality: "Pakistani",
          religion: "Islam",
          orphan: false,
          father_occupation: pick(rand, OCCUPATIONS),
          monthly_income: between(rand, 25, 90) * 1000,
          family_members: between(rand, 4, 9),
          financial_assistance: rand() < 0.25,
          ssc_roll_no: String(between(rand, 100000, 999999)),
          ssc_registration_no: String(between(rand, 1000000, 9999999)),
          matric_marks_obtained: matricObtained,
          matric_total_marks: matricTotal,
          matric_percentage: Number(((matricObtained / matricTotal) * 100).toFixed(2)),
          board: pick(rand, BOARDS),
          student_group: "Science",
          // No photograph on purpose — see the note at the top of this file.
          profile_picture_url: null,
          bform_doc_url: null, father_id_doc_url: null, marksheet_url: null,
          noc_url: null, verified_marksheet_url: null,
          deleted_at: null,
          created_at: at(daysAgo(enrolledDaysAgo)),
          _enrolledDaysAgo: enrolledDaysAgo, // consumed below, deleted after
        });
      }
    });
  });

  // One girl in the bin, so Deleted Items is not an empty screen.
  const removed = db.students[db.students.length - 1];
  removed.deleted_at = at(daysAgo(9));

  // Demo override: ensure no real numbers/IDs are exposed in the demo.
  // Set every student's WhatsApp and CNIC fields to inert placeholders.
  db.students.forEach((s) => {
    s.whatsapp = "123456";
    s.cnic = "12345-1234567-1";
    s.father_cnic = "12345-1234567-1";
    s.phone = s.phone || "123456";
    s.phone2 = s.phone2 || null;
  });

  /* --------------------------------------------------------- attendance */

  // Six days a week for the last eleven weeks: enough for this month and the
  // one reports default to, plus history for the charts.
  const attendanceDays = [];
  for (let d = 78; d >= 0; d -= 1) {
    const day = daysAgo(d);
    if (day.getDay() === 0) continue; // Sunday
    attendanceDays.push(iso(day));
  }

  db.students.forEach((s) => {
    if (s.deleted_at) return;
    attendanceDays.forEach((date) => {
      if (date < iso(daysAgo(s._enrolledDaysAgo))) return; // not enrolled yet
      const roll = rand();
      const status = roll < 0.87 ? "Present" : roll < 0.955 ? "Absent" : "Leave";
      db.attendance.push({ id: uid(2), student_id: s.id, date, status, created_at: at(new Date(`${date}T09:00:00`)) });
    });
  });

  /* -------------------------------------------------------- class tests */

  const testTitles = ["Chapter 1 Test", "Chapter 2 Test", "Weekly Test", "Revision Test", "Unit Test"];

  PROGRAMS.forEach((program) => {
    YEARS.forEach((year) => {
      const classList = db.students.filter((s) => s.program === program && s.year_of_study === year && !s.deleted_at);
      if (classList.length === 0) return;
      const subjects = subjectsFor(program, year).slice(0, 3);

      subjects.forEach((subject) => {
        // Only the girls who actually sit it — Humanities offers three
        // combinations and only one takes Mathematics. Marking the whole class
        // would leave the demo holding marks its own entry screens filter out,
        // which is the inconsistency this seed exists to avoid.
        const roster = classList.filter((s) => sitsSubject(s, subject));
        if (roster.length === 0) return;

        const teacher =
          db.teachers.find((t) => (t.subjects || []).includes(subject) && (t.programs.length === 0 || t.programs.includes(program))) ||
          db.teachers[1];

        // Three tests per subject, spread across the last two months, so the
        // student's Class Tests strip has something to scroll.
        [52, 33, 14].forEach((ago, n) => {
          const test = {
            id: uid(3),
            teacher_id: teacher.id,
            subject,
            program,
            programs: [program],
            year_of_study: year,
            title: testTitles[n % testTitles.length],
            test_date: iso(daysAgo(ago)),
            total_marks: 20,
            created_at: at(daysAgo(ago)),
          };
          db.class_tests.push(test);

          roster.forEach((s) => {
            const absent = rand() < 0.06;
            db.class_test_marks.push({
              id: uid(4),
              class_test_id: test.id,
              student_id: s.id,
              marks_obtained: absent ? null : between(rand, 8, 20),
              is_absent: absent,
              remarks: absent ? "Absent" : null,
              created_at: at(daysAgo(ago - 1)),
            });
          });
        });
      });
    });
  });

  /* ------------------------------------------------------------ results */

  const sendUpDate = daysAgo(46);
  const preBoardDate = daysAgo(17);
  const exams = [
    { name: `Send-Up Exam - ${longDate(sendUpDate)}`, when: sendUpDate },
    { name: `Pre-Board Exam - ${longDate(preBoardDate)}`, when: preBoardDate },
  ];

  exams.forEach((exam) => {
    db.students.forEach((s) => {
      if (s.deleted_at) return;
      subjectsFor(s.program, s.year_of_study).forEach((subject) => {
        db.results.push({
          id: uid(5),
          student_id: s.id,
          exam_name: exam.name,
          subject,
          marks_obtained: between(rand, 42, 98),
          total_marks: 100,
          created_at: at(exam.when),
        });
      });
    });
  });

  /* -------------------------------------------------------- assignments */

  const assignmentSeed = [
    { subject: "English", title: "Essay: My Village", programs: PROGRAMS, days: 24 },
    { subject: "Physics", title: "Numericals — Chapter 3", programs: ["Pre-Engineering", "Pre-Medical"], days: 18 },
    { subject: "Computer Science", title: "HTML Practice Sheet", programs: ["ICS", "FA-IT", "General Science"], days: 12 },
    { subject: "Urdu", title: "Nazm ki tashreeh", programs: PROGRAMS, days: 6 },
    { subject: "Mathematics", title: "Exercise 4.2", programs: ["Pre-Engineering", "ICS", "General Science"], days: -5 },
  ];

  assignmentSeed.forEach((a) => {
    YEARS.forEach((year) => {
      const teacher =
        db.teachers.find((t) => (t.subjects || []).includes(a.subject)) || db.teachers[1];
      const assignment = {
        id: uid(6),
        teacher_id: teacher.id,
        subject: a.subject,
        program: a.programs.length === PROGRAMS.length ? "All Programs" : a.programs[0],
        programs: a.programs,
        year_of_study: year,
        title: a.title,
        description: "Neat handwriting, complete working, and submit on time.",
        file_url: null,
        total_marks: 20,
        start_date: iso(daysAgo(a.days + 10)),
        due_date: iso(daysAgo(a.days)),
        created_at: at(daysAgo(a.days + 10)),
      };
      db.assignments.push(assignment);

      db.students
        .filter((s) => !s.deleted_at && a.programs.includes(s.program) && s.year_of_study === year)
        .forEach((s) => {
          if (rand() < 0.25) return; // she has not handed it in
          const graded = a.days > 0 && rand() < 0.7;
          db.assignment_submissions.push({
            id: uid(7),
            assignment_id: assignment.id,
            student_id: s.id,
            file_url: DEMO_DOC("Assignment submission"),
            submitted_at: at(daysAgo(a.days + between(rand, -1, 4))),
            marks_obtained: graded ? between(rand, 11, 20) : null,
            remarks: graded ? "Good work" : null,
            graded_at: graded ? at(daysAgo(Math.max(a.days - 2, 1))) : null,
            created_at: at(daysAgo(a.days + 4)),
          });
        });
    });
  });

  /* --------------------------------------------------------------- fees */

  db.students.forEach((s) => {
    const plan = db.fee_plans.find((p) => p.year_of_study === s.year_of_study && p.program === s.program);
    buildFeeRowsLikeApp(plan, s).forEach((row) => {
      const fee = { id: uid(8), ...row, amount_paid: 0, last_payment_date: null, created_at: at(daysAgo(s._enrolledDaysAgo)) };
      db.fees.push(fee);

      // Older charges are mostly settled; the newest ones are where the work is.
      // The bands must not overlap — an earlier version tested `roll < 0.55`
      // after `roll < 0.72` had already claimed the same range, so no charge was
      // ever left Pending and the admin's Fee Verification screen came up empty.
      const overdue = fee.due_date < iso(today());
      const roll = rand();

      if (overdue) {
        if (roll < 0.6) {
          addPayment(db, fee, fee.amount_due, "Success", "admin", rand);
        } else if (roll < 0.76) {
          addPayment(db, fee, Math.round(fee.amount_due / 2), "Success", "admin", rand);
        } else if (roll < 0.9) {
          // Proof uploaded by the student, waiting on the office: this is what
          // fills the admin's Fee Verification screen.
          addPayment(db, fee, fee.amount_due, "Pending", "student", rand);
        }
        // The remainder stay Unpaid, which is what the Unpaid tab is for.
      } else if (roll < 0.2) {
        // Paid early, still waiting to be verified.
        addPayment(db, fee, fee.amount_due, "Pending", "student", rand);
      }
    });
  });

  db.fees.forEach((fee) => recomputeFee(db, fee));

  /* ----------------------------------------------- applications & rest */

  const appSeed = [
    { status: "Pending", days: 3 }, { status: "Pending", days: 6 }, { status: "Pending", days: 11 },
    { status: "Approved", days: 40 }, { status: "Rejected", days: 27 },
  ];

  appSeed.forEach((a, i) => {
    const program = PROGRAMS[i % PROGRAMS.length];
    const bform = `3520${between(rand, 1000000, 9999999)}${between(rand, 100, 999)}`;
    const marks = between(rand, 600, 1020);
    db.applications.push({
      id: uid(9),
      student_name: FIRST_NAMES[(nameIndex += 1) % FIRST_NAMES.length],
      father_name: pick(rand, FATHER_NAMES),
      dob: iso(new Date(enrolYear - 17, between(rand, 0, 11), between(rand, 1, 28))),
      father_cnic: `${bform.slice(0, 5)}-${bform.slice(5, 12)}-${bform.slice(12)}`,
      bform: `${bform.slice(0, 5)}-${bform.slice(5, 12)}-${bform.slice(12)}`,
      phone1: `030${between(rand, 10000000, 99999999)}`,
      phone2: null,
      whatsapp: `030${between(rand, 10000000, 99999999)}`,
      email: null,
      address: `${pick(rand, CITY_AREAS)}, Gujranwala`,
      program,
      group_selected: program,
      subject_combination: comboFor(rand, program),
      year_of_study: "1st Year",
      board: pick(rand, BOARDS),
      matric_marks: marks,
      matric_marks_obtained: marks,
      matric_total_marks: 1100,
      matric_percentage: Number(((marks / 1100) * 100).toFixed(2)),
      student_group: "Science",
      status: a.status,
      nationality: "Pakistani",
      religion: "Islam",
      orphan: false,
      father_occupation: pick(rand, OCCUPATIONS),
      monthly_income: between(rand, 25, 90) * 1000,
      family_members: between(rand, 4, 9),
      financial_assistance: rand() < 0.3,
      ssc_roll_no: String(between(rand, 100000, 999999)),
      ssc_registration_no: String(between(rand, 1000000, 9999999)),
      photo_url: null, bform_doc_url: null, father_id_doc_url: null,
      marksheet_url: null, noc_url: null, verified_marksheet_url: null,
      deleted_at: null,
      created_at: at(daysAgo(a.days)),
    });
  });

  // Demo override for applications: replace B-Form, father CNIC and WhatsApp
  db.applications.forEach((app) => {
    app.bform = "12345-1234567-1";
    app.father_cnic = "12345-1234567-1";
    app.whatsapp = "123456";
    app.phone1 = app.phone1 || "123456";
  });

  // `audience` is stamped on every seeded notice because the three reader screens
  // filter on it — a row without one is returned to nobody. The last entry is the
  // staff-only kind, so the demo shows a teacher something her students cannot see.
  // Dated forward from today, like everything else in the seed, so the blinking
  // "Next Test" box on the demo home page always has a real date to announce.
  // Written the way the office actually types a schedule — one subject a line.
  const testDay = (n) => {
    const d = today();
    d.setDate(d.getDate() + n);
    return longDate(d);
  };

  [
    { title: "Weekly Test Schedule", category: "Exam",
      body: [
        `Biology — ${testDay(2)}`,
        `Physics — ${testDay(4)}`,
        `Chemistry — ${testDay(6)}`,
        "Tests start at 8:30 AM. Bring your own stationery.",
      ].join("\n") },
    { title: "Annual Prize Distribution on 25th of this month — all students must attend in uniform.", category: "Event" },
    { title: "Pre-Board result cards will be issued to parents next week.", category: "Exam" },
    { title: "Fee for the current installment is due by the 10th. Please clear dues at the office.", category: "Fee" },
    { title: "College will remain closed on Friday for maintenance.", category: "Holiday" },
    { title: "Extra Physics classes for 2nd year start Monday, 2:00 PM.", category: "Academic" },
    { title: "Staff meeting on Thursday at 11:00 AM in the principal's office.", category: "Staff",
      body: "Class test marks for the current month must be entered before the meeting. Bring your attendance registers.",
      audience: "teachers" },
  ].forEach((n, i) => db.notices.push({
    id: uid(10), audience: "all", body: null, file_url: null, file_name: null,
    ...n, created_at: at(daysAgo(i * 4 + 1)),
  }));

  // One of each audience, so the demo shows the dialog to a student and a
  // different one to a teacher. Dated inside SHOW_FOR_DAYS or they would never
  // open — the seed is relative to today like everything else here.
  [
    { audience: "all", title: "Parent–teacher meeting", body: "The parent–teacher meeting is this Saturday at 10:00 AM in the college hall. Please make sure your parents attend." },
    { audience: "students", title: null, body: "Fee collection closes at 1:00 PM today. Bring the challan with you." },
    { audience: "teachers", title: "Marks deadline", body: "Class test marks for this month must be entered before Thursday. The office prints the reports on Friday morning." },
  ].forEach((m, i) => db.portal_messages.push({
    id: uid(11), created_by: null, ...m, created_at: at(daysAgo(i + 1)),
  }));

  const lmsSeed = [
    { subject: "Physics", category: "lecture", title: "Motion & Force — recorded lecture",
      body: "Watch before Monday's class.", link_url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      programs: ["Pre-Engineering", "Pre-Medical"] },
    { subject: "Computer Science", category: "notes", title: "HTML basics — notes",
      body: "Tags, attributes and a first page. Practise every example yourself.", link_url: null,
      programs: ["ICS", "FA-IT", "General Science"] },
    { subject: "English", category: "paper", title: "Last year's paper",
      body: "Attempt it in two hours without looking at the book.", link_url: null, file_url: DEMO_DOC("Last year's English paper"),
      programs: PROGRAMS },
    { subject: "Mathematics", category: "scheme", title: "Paper scheme for the annual exam",
      body: "Chapters 1–5 carry the most weight.", link_url: null, programs: ["Pre-Engineering", "ICS", "General Science"] },
    { subject: "Chemistry", category: "notes", title: "Important reactions to memorise",
      body: "One page. Revise it daily for a week.", link_url: null, programs: ["Pre-Medical", "Pre-Engineering"] },
  ];

  lmsSeed.forEach((m, i) => {
    const teacher = db.teachers.find((t) => (t.subjects || []).includes(m.subject)) || db.teachers[1];
    YEARS.forEach((year) => {
      db.lms_materials.push({
        id: uid(11),
        program: m.programs.length === PROGRAMS.length ? "All Programs" : m.programs[0],
        programs: m.programs,
        subject: m.subject,
        year_of_study: year,
        category: m.category,
        title: m.title,
        body: m.body,
        link_url: m.link_url || null,
        file_url: m.file_url || null,
        file_name: m.file_url ? "old-paper.pdf" : null,
        teacher_id: teacher.id,
        deleted_at: null,
        created_at: at(daysAgo(i * 5 + 2)),
      });
    });
  });

  const live = db.students.filter((s) => !s.deleted_at);
  db.profile_edit_requests.push(
    {
      id: uid(12), student_id: live[3].id, reason: "My father's mobile number has changed.",
      status: "Pending", admin_note: null, approved_until: null, reviewed_at: null, created_at: at(daysAgo(2)),
    },
    {
      // Still open, so the student portal can demonstrate an edit window.
      id: uid(12), student_id: live[0].id, reason: "Home address is wrong on my form.",
      status: "Approved", admin_note: "Corrected address only.",
      approved_until: at(new Date(Date.now() + 36 * 3600 * 1000)),
      reviewed_at: at(daysAgo(1)), created_at: at(daysAgo(2)),
    }
  );

  const lastMonth = new Date(today().getFullYear(), today().getMonth() - 1, 1);
  const monthKey = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`;
  live.slice(0, 3).forEach((s) => {
    db.report_log.push({
      id: uid(13), student_id: s.id, month: monthKey, file_url: DEMO_DOC("Monthly report"),
      attendance_percent: between(rand, 78, 97), test_percent: between(rand, 55, 92),
      sent_by: db.admin_profiles[0].user_id, sent_at: at(daysAgo(between(rand, 2, 20))),
      created_at: at(daysAgo(20)),
    });
  });

  /* ------------------------------------------------------ staff payroll */

  // One declared holiday last month, because it is the clearest way to show what
  // a holiday does: nothing at all to a Regular teacher's salary, one unpaid day
  // to a Visiting one. Sundays are never seeded — the weekly off lives in code.
  const holidayDate = iso(new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 14));
  db.college_holidays.push({ date: holidayDate, title: "Public Holiday", created_at: at(daysAgo(45)) });

  const now = today();
  const payrollMonths = [lastMonth, new Date(now.getFullYear(), now.getMonth(), 1)];

  // Teachers and staff share one register, distinguished only by which foreign
  // key is filled in — the same shape the database enforces.
  const payrollPeople = [
    ...db.teachers.map((t) => ({ row: t, kind: "teacher", column: "teacher_id" })),
    ...db.staff.map((s) => ({ row: s, kind: "staff", column: "staff_id" })),
  ];

  payrollPeople.forEach(({ row: person, column }, ti) => {
    payrollMonths.forEach((monthStart) => {
      const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
      for (let day = 1; day <= daysInMonth; day += 1) {
        const d = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
        if (d > now) break;              // the running month is only marked up to today
        if (d.getDay() === 0) continue;  // Sunday — the weekly off is never a row
        const date = iso(d);
        if (date === holidayDate) continue;

        // Enough absence to make the free-day and deduction rules visible without
        // making the staff look unreliable — a day or two off each month.
        const roll = rand();
        let status = "Present";
        if (roll > 0.97) status = "Absent";
        else if (roll > 0.945) status = "Leave";
        else if (roll > 0.935) status = "Half Day";

        db.staff_attendance.push({
          id: uid(40 + ti),
          teacher_id: null,
          staff_id: null,
          [column]: person.id,
          date,
          status,
          remarks: null,
          created_at: at(d),
        });
      }
    });
  });

  // Last month is half settled: a few are paid, the rest are outstanding so the
  // Salary screen opens with something left to do. One teacher and one staff
  // member are among the paid, so both sides of the sheet are represented. The
  // figures come from the app's own calculation — the demo cannot disagree with
  // itself.
  [payrollPeople[0], payrollPeople[1], payrollPeople[4], payrollPeople[5]]
    .filter(Boolean)
    .forEach(({ row: personRow, kind }) => {
      const person = { ...personRow, kind };
      const attendance = {};
      db.staff_attendance
        .filter((r) => (kind === "staff" ? r.staff_id : r.teacher_id) === person.id && r.date.startsWith(monthKey))
        .forEach((r) => { attendance[r.date] = r.status; });

      const calc = computeSalary({ person, attendance, monthKey, holidays: [holidayDate] });

      db.staff_salaries.push({
        id: uid(41),
        teacher_id: null,
        staff_id: null,
        ...salaryRowFor(person, calc, {
          paid_amount: calc.netPayable,
          status: "Paid",
          paid_on: iso(daysAgo(between(rand, 3, 9))),
          payment_method: "Cash",
          notes: null,
          recorded_by: db.admin_profiles[0].user_id,
        }),
        created_at: at(daysAgo(10)),
        updated_at: at(daysAgo(10)),
      });
    });

  /* ---------------------------------------------------------- expenses */

  // The third input to the Accounts screen. Fee income and the wage bill are
  // read from tables seeded above; this is everything else the college pays
  // for. Spread across the last ten months so the month-wise profit and loss
  // has a shape rather than one spike.
  //
  // Never a salary. Salaries are counted from staff_salaries, so seeding one
  // here would demonstrate the exact double-count the real screen warns about.
  //
  // The amounts are scaled to the fee income this seed actually produces, not
  // to a real college's bills. A demo that opens on a heavy annual loss reads
  // as a broken screen rather than a working one, and the seeded roster is
  // sixty girls with a deliberately messy fee ledger behind them.
  const expenseSeed = [
    { category: "Rent", description: "Building rent", lo: 9000, hi: 9000, every: true },
    { category: "Utility Bills", description: "Electricity bill", lo: 4000, hi: 9000, every: true },
    { category: "Utility Bills", description: "Gas and water charges", lo: 900, hi: 1800, every: true },
    { category: "Internet & Phone", description: "Broadband and phone line", lo: 2000, hi: 2800, every: true },
    { category: "Stationery & Printing", description: "Exam papers and registers", lo: 1200, hi: 4000 },
    { category: "Repairs & Maintenance", description: "Fan and wiring repairs", lo: 700, hi: 2600 },
    { category: "Repairs & Maintenance", description: "Whitewash and classroom repairs", lo: 2500, hi: 7000 },
    { category: "Transport & Fuel", description: "College van fuel", lo: 2500, hi: 5500 },
    { category: "Furniture & Equipment", description: "Desks and chairs", lo: 3000, hi: 10000 },
    { category: "Marketing & Advertising", description: "Admission banners and pamphlets", lo: 1500, hi: 5000 },
    { category: "Events & Functions", description: "Annual prize distribution", lo: 4000, hi: 9000 },
    { category: "Government & Legal", description: "Board affiliation and registration fees", lo: 2500, hi: 7000 },
    { category: "Other", description: "Tea, cleaning supplies and sundries", lo: 500, hi: 1500 },
  ];

  for (let back = 9; back >= 0; back -= 1) {
    // A negative month rolls into the previous year on its own, which is what
    // makes the January-to-December table fill in for a demo opened in March.
    const monthStart = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();

    expenseSeed.forEach((item, ei) => {
      // The fixed running costs land every month; the rest turn up now and then,
      // the way repairs and functions actually do.
      if (!item.every && rand() > 0.4) return;

      const day = Math.min(between(rand, 1, 26), daysInMonth);
      const spent = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
      if (spent > now) return; // nothing is spent in the future

      db.expenses.push({
        id: uid(50 + ei),
        spent_on: iso(spent),
        category: item.category,
        description: item.description,
        amount: between(rand, item.lo, item.hi),
        payment_method: pick(rand, ["Cash", "Bank Transfer", "Cheque"]),
        notes: null,
        recorded_by: db.admin_profiles[0].user_id,
        created_at: at(spent),
        updated_at: at(spent),
      });
    });
  }

  db.students.forEach((s) => delete s._enrolledDaysAgo);
  return db;
}

/* ----------------------------------------------------------- fee helpers */

/**
 * The same walk `buildFeeRows` in lib/feePlans.js does.
 *
 * Deliberately duplicated rather than imported: that module imports the Supabase
 * client, and the demo client is what is being built here — importing it would
 * close a cycle through a half-initialised module.
 */
function buildFeeRowsLikeApp(plan, student) {
  if (!plan) return [];
  const rows = [];
  const from = new Date();
  from.setDate(from.getDate() - student._enrolledDaysAgo);

  const admissionDue = new Date(from);
  admissionDue.setDate(admissionDue.getDate() + 7);

  if (Number(plan.admission_fee) > 0) {
    rows.push({
      student_id: student.id, program: student.program, year_of_study: student.year_of_study,
      label: "Admission Fee", amount_due: Number(plan.admission_fee),
      due_date: iso(admissionDue), sort_order: 0, status: "Unpaid",
    });
  }

  let cursor = admissionDue;
  (plan.installments || []).forEach((inst) => {
    const amount = (Number(inst.months) || 0) * Number(plan.monthly_fee || 0);
    if (amount <= 0) return;

    let due;
    if (inst.due_month == null) {
      due = new Date(admissionDue);
    } else {
      const month = Number(inst.due_month) - 1;
      let y = cursor.getFullYear();
      due = new Date(y, month, 10);
      for (let guard = 0; due < cursor && guard < 3; guard += 1) {
        y += 1;
        due = new Date(y, month, 10);
      }
    }
    cursor = due;

    rows.push({
      student_id: student.id, program: student.program, year_of_study: student.year_of_study,
      label: inst.label || "Installment", amount_due: amount,
      due_date: iso(due), sort_order: rows.length, status: "Unpaid",
    });
  });

  return rows;
}

function addPayment(db, fee, amount, status, recordedBy, rand) {
  db.payment_transactions.push({
    id: uid(14),
    fee_id: fee.id,
    payment_method: recordedBy === "admin" ? "Cash" : pick(rand, ["Easypaisa", "JazzCash", "Bank Transfer"]),
    amount,
    gateway_txn_id: null,
    reference_number: String(between(rand, 100000000, 999999999)),
    proof_image_url: recordedBy === "student" ? DEMO_IMAGE : null,
    status,
    verified_by: status === "Success" ? "Office" : null,
    recorded_by: recordedBy,
    created_at: at(new Date(`${fee.due_date}T11:00:00`)),
  });
}

/** The same derivation Fee.jsx and FeeVerification.jsx do from Success rows. */
function recomputeFee(db, fee) {
  const txns = db.payment_transactions.filter((t) => t.fee_id === fee.id);
  const paid = txns.filter((t) => t.status === "Success").reduce((a, t) => a + Number(t.amount || 0), 0);
  const due = Number(fee.amount_due || 0);
  const hasPending = txns.some((t) => t.status === "Pending");

  fee.amount_paid = paid;
  fee.last_payment_date = paid > 0 ? at(new Date(`${fee.due_date}T11:00:00`)) : null;
  fee.status = paid >= due && due > 0 ? "Paid" : hasPending ? "Pending Verification" : paid > 0 ? "Partially Paid" : "Unpaid";
}

/* ------------------------------------------------------- demo sign-ins */

/**
 * The accounts the login screen offers as one-click buttons.
 *
 * Students have no auth in this app — a roll number and a password column — so
 * the student and parent entries carry a roll number instead of an email. The
 * roll number is resolved at click time from the seeded roster, because it is
 * generated, not written down here.
 */
export const DEMO_PASSWORD = "cmgc123";

export const DEMO_LOGINS = [
  { role: "student", label: "Student", hint: "See her own attendance, tests, fee and reports" },
  { role: "parent", label: "Parent", hint: "The same screens a parent is shown" },
  { role: "teacher", label: "Teacher", email: "hina.teacher@cmgc.demo", hint: "Class tests, attendance, results, LMS" },
  { role: "admin", label: "Admin", email: "principal@cmgc.demo", hint: "Everything, including Manage Admins" },
  { role: "admin", label: "Limited Admin", email: "clerk@cmgc.demo", hint: "Two groups only, four permissions" },
];
