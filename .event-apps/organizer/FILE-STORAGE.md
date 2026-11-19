Private files live in the admin Site's server-side R2 binding, BUCKET. The
owner-private Sites audience protects upload, list, and download routes.
Files are never copied into public assets or the public GitHub repository.

Files & handoff supports uploads, checksummed downloads, and a current event
backup. Uploads require a relative path, a SHA-256 digest, and a known size of
at most 16 MB. R2 verifies the digest while storing the file. Replacing
a different file requires its current ETag; identical retries are idempotent.
Downloads are attachments with no-store and sandbox headers.

The event backup combines the organizer state with a consistent results-table
snapshot, printable participant URLs, reserved cards, contacts, responses,
archives, and timers. It contains private data. Runtime service/signing keys
are not exported; they remain configured on the existing hosted Sites.

Use the main repository's .event-apps/README.md to resume development on another
machine. Keep the current project IDs and hosted storage. Local .private files
are working copies, not the only retained copy of the research or print files.
