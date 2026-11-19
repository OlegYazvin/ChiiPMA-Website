# Event introduction

Open `/intro/` for a single informational slide with ChiPMA’s purpose, event
history, volunteer board, website, and team email. The page uses a white
background, plain text, and two columns that stack on mobile. All content is
visible without JavaScript. A small Fullscreen button appears in supporting
browsers; use Escape to exit fullscreen. There is no slideshow or animation.

This is a buildless static page. It uses the existing locally stored site font.
The homepage featured event and the networking display link to the introduction.

## Numbers and board

`meetup-stats.json` preserves public event IDs, dates, URLs, and aggregate RSVP
counts checked November 19, 2026. It contains no attendee identities. The public
Meetup query returned all 114 past events with no next page; YES RSVP counts
sum to 4,574. Meetup check-in counts are unrecorded, so the page labels this
as attendee RSVPs, not verified attendance or unique people. Upcoming events,
including the November 19 event, are excluded.

The first available Meetup is April 15, 2010:
<https://www.meetup.com/chipma/events/13070393/>. This is the first-meetup date,
not the group's creation date.

The group About page at <https://www.meetup.com/chipma/> lists Oleg Yazvin as
President, Ivan Alfaro as Treasurer, Rayna Monforti and Omar Bennani as Event
Planning Leaders, and Peter Caron as Advisor. The November 19 event additionally
identifies Lavanya Mathur as a board member:
<https://www.meetup.com/chipma/events/316659297/>. Oleg's presidency and the
board's volunteer status were also confirmed by the organizer.

Update the numbers, first date, source note, and JSON snapshot together when
refreshing the history. Keep the count limited to past events; check pagination.
The public page has no runtime Meetup dependency.

## Parul's portrait

The shared `assets/facilitators/parul-mahajan.webp` was refreshed November 19,
2026 from Parul's public profile at <https://topmate.io/parul_mahajan>.
Original portrait: <https://static.topmate.io/profile_pic_d620ca46-e63e-4aea-b2f0-0f19fed5cc6b.jpeg>.
The source has no Open to Work badge. Only resizing and WebP conversion were
applied. The image is stored locally to avoid relying on a third-party URL.
