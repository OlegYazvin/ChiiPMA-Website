# Continue ChiPMA event work on another machine

The public website and both event applications are versioned in this main
repository. This hidden directory contains the complete application source,
tests, locked dependencies, bundled browser assets, and hosting manifests.
It is omitted from both Jekyll and the Pages artifact upload. It contains no
attendee research, contact records, QR access codes, or runtime credentials.

| Component | Source | Hosted project |
| --- | --- | --- |
| Private organizer | `organizer/` | `appgprj_6afa77820b388191a3f24d31a335e2e7` |
| Results and participant service | `results/` | `appgprj_6afa77922b508191a08b3a1c1896b020` |
| Public display and participant page | `../speed-networking-event/` | Main repository, GitHub Pages |

Open the [private admin](https://chipma-networking-organizer.mikesmythe.chatgpt.site)
with the same ChatGPT account and workspace. Attendance, classifications,
matches, questions, QR assignments, contacts, feedback, timers, and reset
archives persist in hosted storage; they do not depend on this computer.

Use **Files & handoff** to download the private research workspace, original
QR card PDFs, station-number PDFs, and any preserved unfinished website work.
The research archive includes professional histories, LinkedIn evidence,
classification tables, scripts, notes, and past validation snapshots. The
working-tree bundle preserves unpublished drafts without deploying them.
An included manifest lists the files and checksums. Reinstall print-tool
dependencies from the included requirements file instead of copying caches.

**Download current event backup** exports the current organizer and participant
data, including private URLs, contacts, responses, timers, and restart archives.
Keep these downloads private. Runtime service and signing secrets remain on
the existing hosted projects and are not exported or committed. Keeping those
projects preserves existing printed QR codes.

To continue development:

1. Clone this repository and read this file. The Node version and install/build
   commands are declared in each application's `package.json`.
2. For public-page changes, edit `speed-networking-event/`, run the Python and
   frontend tests, then publish through the repository's normal PR/Pages flow.
3. For hosted application changes, use the Sites skill to **open the existing
   project** into a fresh checkout outside this tracked mirror. Request current
   source access for the exact project ID above. Do not create a replacement
   Site, rotate signing secrets, or replace hosted storage merely because the
   computer changed.
4. Develop and publish from that Sites checkout using the Sites workflow. Its
   source repository remains the deployment authority. The matching, timer,
   restart, and portability tests use synthetic data.
5. After publication, run `scripts/sync_event_app_sources.py` with the two clean
   Sites checkout paths. Commit the updated mirrors and source manifest here.
6. Put new research and private print files in **Files & handoff**, rather than
   committing them to GitHub. Local `.private/` directories are working caches.

`source-manifest.json` identifies the mirrored Sites source commits and the
SHA-256 of every file. Private research files and runtime records are held in
the admin app, not in this manifest. Historical snapshots are reference
material; use a fresh event backup before changing the current event.
