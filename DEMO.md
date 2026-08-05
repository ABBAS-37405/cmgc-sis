# The demo build

A complete, working copy of the portal filled with invented students, for
showing people what the system does. No login, no database, no keys.

```bash
npm run dev:demo      # locally, on http://localhost:5173
npm run build:demo    # production files in dist/, for Netlify
```

Open it and the login card carries five buttons — Student, Parent, Teacher,
Admin, Limited Admin. One click goes straight in. Nothing needs to be typed and
no password has to be handed out.

## What is in it

Sixty girls across all six groups and both years, and a year of records around
them: about 3,400 attendance marks over the last eleven weeks, 108 class tests
with marks, two term exams (a Send-Up and a Pre-Board), assignments with
submissions, a full fee ledger, notices, LMS material, applications waiting to
be approved and one girl in the deleted bin.

It is deliberately messy in the places a demo needs to be:

| Screen | What is waiting there |
| --- | --- |
| Students → Applications | 3 pending, 1 approved, 1 rejected |
| Students → Edit Requests | 1 waiting for an answer, 1 already approved and still open |
| Students → Deleted Items | 1 girl |
| Fee Verification → Pending | 32 payments with proof, waiting to be approved |
| Fee Verification → Unpaid | 64 unpaid and 21 part-paid charges |
| Teachers | 3 with logins, 1 with none — the "Create Login" case |
| Manage Admins | a super admin, and a clerk limited to two groups |

The numbers above come from a fixed seed, so every person you send the link to
sees exactly the same college.

## Dates move with today

Nothing is hardcoded to 2026. Attendance covers the last eleven weeks, the
exams sit a few weeks back, and fee instalments fall due around now — so the
demo still opens on a full month of data a year from now. Reports default to
the month that just ended, and that month is seeded densely on purpose.

## What a visitor can do

Everything. Mark attendance, enter marks, approve a fee, approve an
application, generate and download a PDF report, publish a notice. It all
behaves exactly as the real portal does, because it **is** the real portal —
only the database underneath it is different.

Two consequences worth saying out loud:

- **Changes live in that browser tab only.** Refreshing gives the seeded
  college back. Two people looking at the demo do not see each other's edits.
- **The Reset button** (bottom-left, next to the "Demo" marker) rebuilds
  everything and reloads, if a screen has been left in a state you would rather
  not present from.

## Putting it on Netlify

The demo is the same repository, not a copy of it. In Netlify, add a **second
site** from `ABBAS-37405/cmgc-sis` and change one field:

| Setting | Value |
| --- | --- |
| Build command | `npm run build:demo` |
| Publish directory | `dist` |
| Environment variables | none — the demo has no Supabase and no keys |

That is the whole difference. Both sites build from `main`, so a fix to the
real portal reaches the demo on the next deploy without anything being copied
across.

Give the demo site a name that says what it is, for example
`cmgc-demo.netlify.app`.

## How it works, in one paragraph

`vite.config.js` defines a build-time constant `__DEMO__`, true only under
`--mode demo`. `src/lib/supabaseClient.js` reads it and hands the app an
in-memory client from `src/demo/` instead of a real Supabase one. Because the
constant is a literal, the production build folds the branch away and Rollup
drops the whole `src/demo` folder — the real site ships none of it. That is
worth checking after any change here:

```bash
npm run build
# landing bundle ~423 kB, stylesheet 19.4 kB
grep -c demo-banner dist/assets/index-*.js   # must be 0
```

Curiously the demo build is the *smaller* of the two (254 kB), because it does
not ship the Supabase SDK at all.

## What is not real

- **Nobody in the demo exists.** Names, B-Form numbers, phone numbers and marks
  are all invented.
- **No student has a photograph.** The campus photos in `public/images` are of
  real girls and are never attached to a fake record.
- Uploaded documents and payment proofs are placeholder images and pages, so
  every "View" and "Download" button still opens something.
- The one YouTube link in the LMS points at a public sample video. Swap it in
  `src/demo/demoData.js` for a real lecture if you would rather show your own.
