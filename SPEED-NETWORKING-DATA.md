# Local speed-networking research

Attendee research lives in `.private/speed-networking-event/attendees.json`.
The entire `.private/` directory is Git-ignored. Its contents are local to this
checkout: Git does not version, synchronize, or back them up. Keep research notes
and the unresolved-match review list in that same directory. Do not copy attendee
details into tracked documentation, public pages, or test fixtures.

Research uses the user's authorized, logged-in LinkedIn session. Access can
come from a connected browser or an authorized local-session reader when the
environment provides that capability. Keep authentication values in memory;
never put them in research files, logs, or version control. Until authenticated
access is available, records remain explicitly pending or blocked, with no
selected profile or invented research outcome. Public search does not replace
the requested authenticated source.

## Dataset format

The JSON contains event metadata, research progress, and the attendee roster in
its supplied order. Event metadata records the cohort, expected attendee count,
and intended app URL. Each attendee preserves their name and aliases and has a
stable ID, research status/date, profile match, source evidence, and professional
experience fields. Roles, organizations, dates, education, projects, explicitly
listed skills, and the concise summary are recorded only when supported by the
selected profile's sources. Unavailable details remain empty.

Completed research uses `high_confidence`, `needs_review`, or `not_found` match
statuses. A selected profile requires both a name/alias match and explicit
Northwestern MPD² affiliation evidence, including organizer confirmation when
recorded as such. Keep organizer-provided evidence distinct from information
independently visible on LinkedIn. Ambiguous candidates retain their URLs and
evidence separately; their experience is not attributed to the attendee.
Pending or blocked research has a null match status, rather than `not_found`.

Validate the local records with:

```sh
python3 scripts/validate_attendees.py
python3 scripts/validate_attendees.py --require-complete
```

The second command additionally requires completed research for the full roster.
Automated tests use synthetic data and do not require the private dataset.

## Meetup attendee links

The event's Meetup RSVP roster is stored separately in
`.private/speed-networking-event/meetup-attendees.json`; its participants are
not automatically part of the student cohort. The local
`meetup-linkedin-report.csv` and `meetup-linkedin-report.txt` summarize the
results. Records distinguish links supplied in Meetup profiles or group
registration answers, search candidates needing confirmation, and attendees
without a reliable match. Candidate links stay separate from selected links.
Cross-references to student records use the selected LinkedIn URL.

## Combined attendee classifications

`.private/speed-networking-event/all-attendees.json` combines the student and
Meetup rosters with organizer-added people from `additional-attendees.json`,
and deduplicates shared LinkedIn profiles. Organizer-added people keep their
own profile details without being inserted into the student or Meetup RSVP
roster. `attendee-classifications.csv` contains
the requested Level, Most recent job, and Employment status columns, with
supporting role details, source references, and interpretation notes. Matching
classification objects are also stored on the original roster records.

Students use their highest achieved professional level; other attendees use
their current or most recent professional role. Working students receive both
Student and the primary current work category and count as employed. A student
without current work counts as unemployed. Per the organizer's rule, a last
job that has ended with no later active work is also classified as unemployed;
the notes identify this as an assumption from the listed history. Missing
profiles remain blank rather than receiving a guessed category.

The categories describe work and scope, rather than employer industry or
aspirational headlines. Contract, part-time, freelance, and self-employed work
count as work. Role titles and scope do not always establish an official
seniority grade or direct-report responsibility. The organizer has accepted all
classification determinations: the CSV records accepted status, and no pending
review flags remain. Source notes and acceptance provenance are retained.
Genuinely missing data stays blank and is listed in `classification-data-gaps.csv`;
it does not make the rest of the table provisional. The legacy
`classification-review.csv` is empty after acceptance.

## Publication boundary

Git-ignore prevents accidental addition to version control; publishing has its
own boundary. The branch-source GitHub Pages build uses Jekyll's exclusion of
dot-prefixed directories. The scheduled blog workflow uses
`actions/upload-pages-artifact@v4`, whose archive command excludes dot-prefixed
paths with `--exclude=".[^/]*"`, even when the uploaded source is the repository
root. Do not add `.nojekyll`, explicitly include `.private/` in Jekyll, copy the
records into public output, or change publishing tools without rechecking this
boundary. These rules do not protect files served by an arbitrary local server
or manually uploaded elsewhere.

`tests/test_private_data.py` checks Git-ignore and tracked-file boundaries, a
synthetic Pages archive with a public positive control, the Jekyll configuration,
and the absence of private-data references in public files and the blog generator.
Run the repository checks with:

```sh
python3 -m unittest discover -s tests
git diff --check
```

## Round organizer and public display

The organizer runs as an owner-private ChatGPT Site, with source in the ignored
`.private/sites/` directory. It imports a minimal scheduling roster: stable IDs,
display names, attendance selections, MPD² cohort membership, accepted levels,
job categories, employment status, and whether leadership is current. Current
leadership is separate from a student's highest historical professional level.
LinkedIn research, profile URLs, and professional histories stay local.

The tool creates twelve complete rounds and prohibits repeated pairs. Student
conversations are restricted to the two configured part-time year groups: one
person from Group 1 and one from Group 2. Same-group and unlisted student pairs
are prohibited, as are pairs sharing a team. The generator first maximizes
current people-leader meetings, then minimizes student conversations while
preserving that maximum. Lower priorities cover all leaders, prioritize
unemployed partners for the configured attendee, and connect IC PMs with more
advanced students.

The per-attendee `studentPairGroup`, `teamId`, and `studentOnlyPartners` settings
persist through import, export, and regeneration. Group eligibility replaces
the previous alternating-anchor exception. A designated reserve is included
only to make the active count even. Additional candidates can stay unchecked
until attendance is confirmed; they do not participate in generated rounds.
The roster and schedule freeze when the host starts the real event. A separate
Start test action rehearses the public display with an explicit TEST RUN banner.
Reset test clears released test rounds, returns the display to waiting, and
unlocks the roster while preserving the generated schedule. Real event rounds
cannot be reset through these controls.

Only the results viewer lives at `https://www.chipma.org/speed-networking-event`.
A separate public service supplies released round numbers, station numbers, pair numbers, and
names, plus an optional lead question for each released round. It receives no
question bank, draft assignments, professional classifications, or unreleased rounds. Host
writes require a server-held secret and version checks; public reads contain no
admin credential. Keep this separation when updating either Site.

Local scheduling input, leadership evidence, generated JSON, and downloadable
CSV remain inside `.private/speed-networking-event/`. The organizer permits
attendance edits and regeneration before the event starts. Its automated tests
use synthetic rosters and do not require the local attendee data.

The organizer's Questions tab keeps candidate lead questions and one optional
assignment for each round in its private database. Questions can be added and
edited on event day, including for upcoming rounds after the event starts.
Released assignments and question text are locked; a test reset unlocks them.
Question changes preserve attendee selections and generated matches. The public
viewer shows an assigned question only after the host releases its round.

## Personal participant pages

The shared page at `/speed-networking-event/participant/#<private-code>` contains
no participant records or real access codes in its source. The private organizer's
Personal pages tab provisions links for the actual scheduled participant set,
prints private QR cards, and exports named conversation ratings. Codes and QR
images are generated at runtime; do not save their output in tracked files.
Participants can bookmark or copy their full link, including its fragment.

Three reserved cards, labeled Person 1–3, have stable private URLs backed by
protected QR-reservation records. Their unchecked roster rows carry `qrSlot`
and `qrPending` markers. The next three names entered through Add attendee
claim those rows in order and keep the printed URLs. New attendees begin
not participating; selecting participation and regenerating the schedule is
a separate organizer action. An unassigned card shows a waiting page and
cannot save contacts or submit ratings. After assignment it becomes that
attendee's personal page, with the same contact-sharing and rating rules.
Reserved cards are never automatically reassigned after they are claimed.
The private Personal pages view lists them separately from scheduled pages
and offers printing, QR downloads, and the current assigned name. Roster
version checks prevent stale synchronization from changing a newer assignment.

The results service stores protected link records, participant-entered contacts,
final conversation responses, and server-authoritative round timers in D1. Link
records contain verification hashes and nonces; the server derives printable
links with its runtime `PARTICIPANT_LINK_SECRET`. Keep that signing secret stable
for the event. The management write credential is separate and never reaches a
participant or the public display. Professional research remains local and is
not imported into contact forms; each contact form starts blank.

Participants explicitly save contact details and submit each completed round
separately. Ratings use frown, neutral, or smile; stay-in-touch is a separate
Yes/No choice. Both choices are required, with no preselection or autosubmission.
Submissions are final and retry-safe. Contact details appear on both personal
pages only after both partners submit Yes. Participants never receive their
partner's rating or a one-sided stay-in-touch decision. Named ratings are
available only through the owner-private organizer. There are no email sends.

Only completed rounds are returned by the participant API, accumulating on one
page through all twelve rounds. Completion requires the full five-minute timer,
excluding host pauses. The private organizer starts and resumes the shared timer
and links directly to the ChiPMA live display. Timer authorization stays on the
admin server; the public display has no timer-start control. Refreshing preserves
the remaining time. The event display preloads and automatically plays the
approved chime at each round's expiry, with no sound toggle. Mute the device
to silence it. When browser autoplay policy requires user activation, a normal
click, tap, or keypress anywhere on the display unlocks audio for later rounds.
A visible message explains an observed autoplay block or audio-loading failure.
Audio initialization never starts or restarts the countdown.
Both the organizer and the results service reject early advance or finish.

Real-event links and contact profiles are separate from rehearsal links and
responses. Reset test closes the old rehearsal links and clears its contacts
and responses while preserving real profiles. Personal pages remain available
after the event until the owner closes access; closing access preserves the
organizer's ratings and can be reversed from the admin app.

The public `/api/state` response includes only released assignments, questions,
and shared timer metadata. Contact/profile and response endpoints require the
participant's bearer code and return only that participant's permitted data.
They use no-store responses and trusted-origin CORS; the participant page disables
referrers. QR generation runs locally in the private admin browser using a bundled
MIT-licensed encoder and does not send private links to a third-party QR service.

New behavior is covered by synthetic backend, participant-page, and shared-timer
tests. The local `scripts/check-personal.mjs` in the organizer checkout exercises
both local services using isolated D1 state, including strict timer enforcement,
mutual sharing, immutable submissions, test isolation, and closing/reopening
access. Its clock shortcut operates only on the isolated local database; there
is no production timer shortcut.

Publishing references: [Jekyll directory structure](https://jekyllrb.com/docs/structure/)
and [Pages artifact action v4](https://github.com/actions/upload-pages-artifact/blob/v4/action.yml).

## Station assignments

There are 21 physical stations, numbered 1–21, with one conversation per active
station in each round. Attendance is capped at 42 active people. Station
assignment preserves the generated pairs and all matching priorities.

When the conversation graph has two equal groups, one group keeps fixed
stations throughout all twelve rounds; the allocator favors keeping MPD²
students seated. Other schedules use maximum-weight assignments between rounds.
With unique partners, at most one person in each pair can stay at the prior
station, so keeping half of the attendees seated each transition is optimal.
The private metrics report stays, movements, and attendees who keep one station
throughout. CSV downloads and the public display include explicit station
numbers. Unused stations stay idle when fewer than 42 attendees participate.
