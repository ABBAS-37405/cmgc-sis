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

export const COMPULSORY_SUBJECTS = ["English", "Urdu", "Islamiat", "Tarjama Tul Quran"];

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
    ["Economics", "Education", "Mathematics"],
    ["Sociology", "Education", "Civics"],
    ["Economics", "Education", "Civics"],
  ],
};

export const PROGRAMS = Object.keys(GROUP_COMBINATIONS);

// Everything a group might study: every elective across its combinations, plus
// the compulsory subjects. Marks-entry screens use this, because a teacher may
// need to record any subject the group offers — not just one student's picks.
export const SUBJECTS = Object.fromEntries(
  Object.entries(GROUP_COMBINATIONS).map(([group, combos]) => [
    group,
    [...new Set(combos.flat()), ...COMPULSORY_SUBJECTS],
  ]),
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
export function subjectsForPrograms(programs = []) {
  if (!programs || programs.length === 0) return ALL_SUBJECTS;
  const set = new Set();
  programs.forEach((p) => (SUBJECTS[p] || []).forEach((s) => set.add(s)));
  return [...set].sort();
}
