// Single source of truth for what each group studies.
//
// A group is defined by its elective combinations. Most groups offer exactly one
// combination, so the student has no choice to make. FA-IT and Humanities offer
// several — the applicant picks one on the admission form, and it is stored on
// her application and carried onto her student record.
//
// Group names are the same strings stored in `students.program`,
// `admin_profiles.allowed_programs`, `teachers.programs` and the RLS policies
// built on them. Renaming one here means updating the database too.

export const COMPULSORY_SUBJECTS = [
  "English",
  "Urdu",
  "Islamiat",
  "Pakistan Studies",
  "Tarjama Tul Quran",
];

// Two of the compulsory subjects belong to one year only: Islamiat is examined in 1st
// year and Pakistan Studies in 2nd. This is the only place a group's subject list
// depends on the year rather than the group, so anything that knows which class it is
// looking at passes the year, and anything that does not (a teacher's subject chips,
// the public Programs section) gets the union.
const YEAR_ONLY_COMPULSORY = {
  "Islamiat": "1st Year",
  "Pakistan Studies": "2nd Year",
};

export function compulsoryFor(year) {
  if (!year) return COMPULSORY_SUBJECTS;
  return COMPULSORY_SUBJECTS.filter(
    (s) => !YEAR_ONLY_COMPULSORY[s] || YEAR_ONLY_COMPULSORY[s] === year,
  );
}

export const GROUP_COMBINATIONS = {
  "Pre-Engineering": [["Physics", "Chemistry", "Mathematics"]],
  "Pre-Medical": [["Physics", "Chemistry", "Biology"]],
  "ICS": [["Computer Science", "Mathematics", "Physics"]],
  "General Science": [["Mathematics", "Economics", "Computer Science"]],
  "FA-IT": [
    ["Economics", "Computer Science", "Civics"],
    ["Sociology", "Computer Science", "Civics"],
  ],
  "Humanities": [
    ["Sociology", "Education", "Mathematics"],
    ["Sociology", "Education", "Civics"],
    ["Economics", "Education", "Civics"],
  ],
};

export const PROGRAMS = Object.keys(GROUP_COMBINATIONS);

// Short forms for the few places a full group name will not fit — the printed
// attendance sheet's Group column above all, where the days of the month
// already eat the width. Display only: nothing is ever stored in this form, so
// `students.program` and the RLS policies still see the full name.
export const GROUP_SHORT = {
  "Pre-Engineering": "Engg",
  "Pre-Medical": "Med",
  "ICS": "ICS",
  "General Science": "G.Sc",
  "FA-IT": "FA-IT",
  "Humanities": "Hum",
};

export function shortGroup(group) {
  return GROUP_SHORT[group] || group || "";
}

// Everything a group might study: every elective across its combinations, plus
// the compulsory subjects. Marks-entry screens use this, because a teacher may
// need to record any subject the group offers — not just one student's picks.
// Pass a year to drop the compulsory subject the other year sits.
export function subjectsFor(group, year) {
  const combos = GROUP_COMBINATIONS[group];
  if (!combos) return [];
  return [...new Set(combos.flat()), ...compulsoryFor(year)];
}

// The year-agnostic form, for the screens that have no class in hand.
export const SUBJECTS = Object.fromEntries(
  Object.keys(GROUP_COMBINATIONS).map((group) => [group, subjectsFor(group)]),
);

export const YEARS = ["1st Year", "2nd Year"];

export const ALL_SUBJECTS = [...new Set(Object.values(SUBJECTS).flat())].sort();

export function combinationsFor(group) {
  return GROUP_COMBINATIONS[group] || [];
}

// True when the applicant actually has something to choose.
export function groupHasChoice(group) {
  return combinationsFor(group).length > 1;
}

export function formatCombination(subjects) {
  return (subjects || []).join(", ");
}

// Subjects offered by the given groups. Empty/omitted groups = every subject.
// A year narrows the compulsory half of the list, exactly like subjectsFor().
export function subjectsForPrograms(programs = [], year) {
  const groups = programs && programs.length > 0 ? programs : PROGRAMS;
  const set = new Set();
  groups.forEach((p) => subjectsFor(p, year).forEach((s) => set.add(s)));
  return [...set].sort();
}
