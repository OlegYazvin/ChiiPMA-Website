For speed-networking work, read `.event-apps/README.md` and
`SPEED-NETWORKING-DATA.md`. Complete admin and backend source mirrors are in
`.event-apps/organizer` and `.event-apps/results`; the public viewer and
participant page are in `speed-networking-event/`.

The existing hosted admin and results projects retain the live event data,
runtime secrets, and printed-code identities. Open those exact project IDs
through the Sites workflow rather than creating replacement Sites. Private
research, original print PDFs, and preserved unfinished work are downloadable
from the admin's Files & handoff tab. A fresh current-event backup is available
there as well; historical snapshots must not overwrite newer hosted state.

Keep attendee research, contact data, private QR URLs, and credentials out of
GitHub and public assets. Local `.private/` files are ignored working copies.
The tracked `.event-apps/` source directory is intentionally excluded from both
Pages publishing mechanisms. Preserve that boundary and verify it when changing
deployment configuration. Update source mirrors after publishing hosted code.
