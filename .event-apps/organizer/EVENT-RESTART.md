Reset real event returns the public display to waiting, unlocks participation,
and clears active round timers and responses. The last schedule, roster,
question assignments, reserved-card assignments, credentials, and saved
contact details remain available. The host can edit attendance, regenerate
the schedule, and start again at round 1.

The private admin requires an explicit confirmation. A pending publication is
completed idempotently before the reset. The results service archives the old
snapshot, participant names/IDs, responses, and timers in the same transaction
that resets the active attempt. Previous attempts are downloadable from
Personal pages. Archives do not contain credentials or contact details.

Each restarted attempt has a distinct ID. Participant feedback and timer
authorization are bound to that attempt, so stale requests cannot populate a
later attempt. Printed QR URLs and saved contact details stay unchanged.
Participant pages discard unsent conversation choices on an attempt change.

The admin starts the shared five-minute timer. The public display follows its
server deadline. Pause/resume preserves remaining time; next/finish require
the shared timer to complete. Reset is intentionally available before expiry.

Validate with the backend participant tests, admin timer/participation tests,
public participant/timer tests, and scripts/check-real-restart.mjs against
isolated local storage. Never start or reset production merely to verify a
deployment.
