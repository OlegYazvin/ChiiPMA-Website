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

The tool creates twelve complete rounds and prohibits repeated pairs. The
configured alternating student anchor meets an MPD² student in odd rounds and a
non-student in even rounds. Other student–student matches are normally excluded.
The optional `allowAdditionalStudentPair` setting permits exactly one additional
student pair each round when the student cohort outnumbers other attendees by
two. This retains six non-student pairs across the event. It scales back to zero
additional pairs when the cohorts balance; larger imbalances require attendance
changes. With a balanced roster there are six student pairs and six non-student
pairs.
Subsequent goals maximize current leader meetings, cover all leaders, prioritize
unemployed partners for the configured attendee, and connect IC PMs with more
advanced students. The per-attendee `alternateStudentPartners` flag preserves
this rule on import, export, and regeneration. A designated reserve is included only to make the count even.
The roster and schedule freeze when the host starts the real event. A separate
Start test action rehearses the public display with an explicit TEST RUN banner.
Reset test clears released test rounds, returns the display to waiting, and
unlocks the roster while preserving the generated schedule. Real event rounds
cannot be reset through these controls.

Only the results viewer lives at `https://www.chipma.org/speed-networking-event`.
A separate public service supplies released round numbers, station numbers, pair numbers, and
names. It receives no professional classifications or unreleased rounds. Host
writes require a server-held secret and version checks; public reads contain no
admin credential. Keep this separation when updating either Site.

Local scheduling input, leadership evidence, generated JSON, and downloadable
CSV remain inside `.private/speed-networking-event/`. The organizer permits
attendance edits and regeneration before the event starts. Its automated tests
use synthetic rosters and do not require the local attendee data.

Publishing references: [Jekyll directory structure](https://jekyllrb.com/docs/structure/)
and [Pages artifact action v4](https://github.com/actions/upload-pages-artifact/blob/v4/action.yml).

## Station assignments

There are 20 physical stations, numbered 1–20, with one conversation per active
station in each round. Attendance is capped at 40 active people. Station
assignment preserves the generated pairs and all matching priorities.

When the conversation graph has two equal groups, one group keeps fixed
stations throughout all twelve rounds; the allocator favors keeping MPD²
students seated. Other schedules use maximum-weight assignments between rounds.
With unique partners, at most one person in each pair can stay at the prior
station, so keeping half of the attendees seated each transition is optimal.
The private metrics report stays, movements, and attendees who keep one station
throughout. CSV downloads and the public display include explicit station
numbers. Unused stations stay idle when fewer than 40 attendees participate.
