# Build prompt: Dropin

A self-contained specification for building this project from nothing. Hand it
to an engineer or a coding agent verbatim. Everything in the **Platform traps**
section was learned by running the thing and getting it wrong first — treat
those as requirements, not trivia.

---

## The prompt

> Build **Dropin**: an open meeting board for a whole company. Anyone opens the
> page, posts a Zoom or Google Meet link with a short title, picks when it
> should disappear, and everyone else can drop in. No accounts, no invites.
>
> Deploy target is **Netlify**: a static page, one Netlify Function for the API,
> **Netlify Blobs** for storage, and a scheduled function for cleanup. No
> database, no framework, no build step. The page must work for thousands of
> people polling every 15 seconds without costing a fortune in function
> invocations.

### Stack and constraints

- Plain HTML, CSS and ES modules. **No framework, no bundler, no build step.**
- Node 20+. Dependencies limited to `@netlify/blobs` and `@netlify/functions`.
- Netlify Functions **v2** (`export default async (req, context)`), routed with
  `export const config = { path: [...] }`.
- Local development is `netlify dev`, which serves the page, runs the functions
  and emulates Blobs on disk.
- Tabs for indentation, double quotes, no semicolon-free style — match whatever
  the repo already does.

### Data model

One meeting:

```json
{
  "id": "uuid",
  "title": "Platform design review",
  "link": "https://us02web.zoom.us/j/84455667788?pwd=k",
  "provider": "zoom" | "meet",
  "owner": "<32 hex chars>",
  "createdAt": "2026-09-21T09:14:22.000Z",
  "expiresAt": "2026-09-21T23:59:00.000Z"
}
```

The whole board is **one JSON array in a single blob** (store `meetings`, key
`board`, strong consistency). Not one blob per meeting: a poll must cost exactly
one read no matter how many people are watching. Cap the board at the **300**
most recent meetings.

### Validation rules — one file, shared

Put the rules in `public/validate.js`, which the browser loads as a module *and*
the function imports (the bundler inlines it). The page and the API must not be
able to disagree.

**Title**: required; whitespace collapsed; ≤ **10 words**; ≤ **120 characters**.

**Link**: must parse as a URL (accept input with no scheme by prepending
`https://`), must end up `https:`, and the **hostname** must match one of:

- `meet.google.com` exactly, with a non-empty path
- `/^(?:[a-z0-9-]+\.)*zoom\.us$/` — covers `zoom.us` and `us02web.zoom.us`
- `/^(?:[a-z0-9-]+\.)*zoomgov\.com$/`

Anchor the host patterns. `https://zoom.us.attacker.com/j/1` and
`https://evil.com/zoom.us/j/1` must both be rejected — a substring check passes
both.

**Expiry**: an ISO timestamp, at least **1 minute** out and at most **48 hours**
out. Allow 5 minutes of clock skew above the maximum and *clamp* rather than
refuse, so a slightly fast browser clock is not an error. Omitted means the full
48 hours.

### API

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `GET` | `/api/meetings` | — | `{ meetings: [...] }` newest first, with `ETag`; `304` when unchanged |
| `POST` | `/api/meetings` | `{ title, link, expiresAt? }` | `201 { meeting }` + identity cookies, or `400 { error }` |
| `DELETE` | `/api/meetings/:id` | — | `200 { ok, removed }`, or `200 { ok: false, error }` when it is not yours |

`GET` must never return an expired meeting, whatever the cleanup has managed.

### Identity and ownership

Only the person who posted a meeting may remove it, and there is no sign-in.
On `POST`, set two cookies (`Path=/`, `Max-Age` one year, `SameSite=Lax`,
`Secure` **only when the request is https**, or local dev silently drops them):

| Cookie | `HttpOnly` | Value | Purpose |
| --- | --- | --- | --- |
| `mb_token` | yes | 32 random bytes, hex | the secret; the only thing that authorises removal |
| `mb_id` | no | `sha256(mb_token)`, first 32 hex chars | lets the page tell which rows are its own |

The meeting stores `mb_id` as `owner` — never the secret. The page renders a
remove button where `meeting.owner === mb_id`; the function independently
hashes the secret cookie and compares. Forging `mb_id` must only make a button
appear, never authorise anything.

**Why the split matters:** the alternative — returning a per-viewer `mine: true`
flag — personalises the response and destroys the shared edge cache below. The
board must stay byte-identical for every viewer.

### Expiry, enforced in three places

None of these has to be perfect on its own:

1. `GET` filters expired meetings out of the response.
2. The page drops a row the moment it lapses, without waiting for a poll.
3. A scheduled function (`*/15 * * * *`) deletes them from storage. Any post or
   removal also prunes on the way past.

Treat a meeting with no `expiresAt` as `createdAt + 48h` so pre-expiry rows
migrate; treat one with no usable date as expired.

### Polling and cost at scale

The page polls `GET /api/meetings` every **15 seconds**. That is ~4 requests per
person per minute; at 3,000 people it is roughly 17M function invocations a day,
which is far past Netlify's included quota. So:

- Send `If-None-Match`; answer `304` with an empty body when unchanged.
- Derive the `ETag` from a **hash of the response body**, not from the blob's
  ETag. (See traps.)
- Cache the list at the edge, while `Cache-Control: no-store` keeps the browser
  asking. The CDN, not the function, answers most polls:

  ```http
  Netlify-CDN-Cache-Control: public, max-age=15, stale-while-revalidate=60, durable
  Netlify-Cache-Tag: meetings
  ```
- `purgeCache({ tags: ["meetings"] })` after any post or removal, so a change is
  visible on the very next poll. Wrap it in try/catch — a failed purge just
  means the board is ≤15s behind, and must never fail the write.
- Stop polling while `document.hidden`; poll immediately on return.

### Concurrent writes

Two people posting in the same instant must not overwrite each other:

1. Read the board with its ETag.
2. Filter out expired entries, apply the change.
3. Write with `onlyIfMatch: <etag>` (or `onlyIfNew: true` when the blob does not
   exist yet). `modified: false` means someone got in first — re-read and
   reapply, up to 5 attempts.
4. Make the change **idempotent by id** (`[meeting, ...live.filter(m => m.id !==
   meeting.id)]`), so a retry can never duplicate a row.

Rate limit posting to **20 per IP per minute**. The counter must live in a blob,
not in memory — serverless instances are not shared. Hash the IP before using it
as a key, and **fail open**: if the limiter itself errors, allow the post.

### The page

Layout, top to bottom: masthead (wordmark) → a short time-of-day greeting and
one-line lede → a compact composer → the board. Resist adding a "Live"
indicator: the arriving rows below already show the board is live, and a pill
that mostly says the same word is noise.

**The composer must not fill the first screen.** Most people open this page to
read it. Two fields side by side on desktop (title, link), the expiry chips and
the post button below. Verify the first meeting row sits above the fold at
900×1100 and at 390×844.

**Composer**: live word counter (`0 of 10 words`, red past the limit); a
provider badge that appears as you type a valid link ("Zoom" / "Google Meet");
expiry chips — *In 4 hours*, *End of today*, *End of tomorrow*, *Pick a time*
(reveals a `datetime-local` with `min`/`max` set to +1 min and +48 h). Default
to *End of today*, falling back to *In 4 hours* when end of day is under an hour
away. `Ctrl`/`⌘`+`Enter` posts.

**The board**: one heading per day (`Today`, `Yesterday`, weekday name, then a
date), sticky while scrolling. Today's rows read as freshness ("12 min ago");
older rows show a clock time prefixed "posted", because the heading already
names the day. Never show a rounded "2 days ago" under a "Yesterday" heading.

**Each row**: provider-tinted avatar, title, then a meta line of
`provider · meeting code · posted · expires`. Show the Zoom id the way Zoom
does (`844 5566 7788` for 11 digits, `844 556 7788` for 10) and the Meet code
(`abc-defg-hij`). Time remaining is **rounded down** — a deadline must never
overstate itself — and turns amber under an hour. Join button, copy-link button,
and the remove button *only on your own rows*.

**Liveness must be visible.** A row that arrives via polling gets an accent
outline and a "New" badge for 20 seconds, and a polite `aria-live`
announcement ("2 new meetings on the board"). Nothing is new on first load.
Skeleton rows cover first paint instead of a blank gap.

**Also**: filter chips carrying counts (`Zoom 7`), a search box focused by `/`,
light and dark themes, and an empty state that differs between "nothing posted"
and "nothing matches your search".

### Design requirements

- Tokenised colour, radius and shadow scales; dark mode via
  `prefers-color-scheme`.
- Self-host the webfont (Inter, `woff2`, unicode-range subsets, license
  included). A font CDN is a third party that corporate networks block — which
  is exactly what happened during development.
- **Every text pair must clear WCAG AA (4.5:1); measure it, do not eyeball it.**
  Target 5.5:1+ for small text. Muted greys chosen by feel land at ~4.5:1.
- Touch targets ≥ 42px on phones. Honour `prefers-reduced-motion`. Visible
  `:focus-visible` rings. No horizontal scroll at 390px.

---

## Platform traps

These cost real debugging time. Build them in from the start.

**1. A function's `403` and `404` are not final answers.** Netlify retries them
against the static files to "mimic the CDN behavior" (the CLI source says so
verbatim), re-invoking the function at paths like `/api/meetings/<id>.html`.
A refused delete returning `403` reached the client as
`{"ok":true,"removed":false}` at `200` — a *successful-looking* response for a
denied request. **Never return 403 or 404 from a path-routed function.** Put the
outcome in the body at `200` and make removal idempotent.

**2. `netlify dev`'s Blobs sandbox does not return ETags on read.** Two
consequences:
- `onlyIfMatch` can never be satisfied, so branching on "did we get an ETag" to
  choose between `onlyIfNew` and `onlyIfMatch` leaves you writing `onlyIfNew` to
  an existing key forever — every write after the first fails. Branch on
  **whether the blob exists**, and fall back to an unconditional write when
  there is no ETag.
- Concurrent posts lose data locally (roughly 2 in 12). That is a sandbox
  artifact; deployed Blobs return ETags and the conditional write applies.
  Re-verify on the real site once.

**3. Do not derive the HTTP `ETag` from the blob's ETag.** With none returned it
collapses to a constant, every poll gets `304`, and the board silently never
updates. Hash the response body instead — it also changes when a meeting expires
out of the list without the stored data changing.

**4. A `Secure` cookie is never stored over plain http**, so local dev logs you
out of your own posts. Set `Secure` only when the request URL is https.

---

## Acceptance criteria

Prove each of these against a running instance, not by reading the code.

**Validation**
- [ ] A Teams link, `https://zoom.us.attacker.com/j/1` and `http://zoom.us/j/1`
      are each rejected with a specific message.
- [ ] An 11-word title is refused client-side; the API refuses it too.
- [ ] Expiry 49 hours out is refused; 47.9 hours is accepted; 3 minutes is
      accepted; a past time and `"next tuesday"` are refused.

**Ownership** (two separate browser contexts)
- [ ] Each identity sees a remove button only on its own rows.
- [ ] Deleting someone else's meeting fails with *no* cookies, with *another
      user's* cookies, and while **forging `mb_id`** with the exact value from
      the public board JSON.
- [ ] The owner's own delete succeeds, and a second delete of the same id is a
      no-op success.

**Expiry**
- [ ] An expired meeting is absent from `GET` while still on disk.
- [ ] A row vanishes from an open page within ~30s of lapsing, with no reload.
- [ ] The scheduled function removes it from storage; an ordinary post also
      prunes.

**Polling and scale**
- [ ] A second poll with `If-None-Match` returns `304` and 0 bytes.
- [ ] After a post, the next poll returns `200` with the new meeting.
- [ ] The `GET` response carries the CDN cache-control and cache-tag headers.

**Interface**
- [ ] First meeting row is above the fold at 900×1100 and 390×844.
- [ ] A meeting posted by someone else appears within one 15s cycle, badged New
      and announced.
- [ ] Skeletons show while the first request is in flight.
- [ ] Contrast measured in both themes: every pair ≥ 4.5:1.
- [ ] No horizontal scroll at 390px; no console errors anywhere.

**Cold start**
- [ ] Wipe local state, boot, and confirm: empty board, first post creates the
      blob, subsequent posts work, page and font both serve.

---

## Out of scope

Do not build: accounts or SSO, editing a posted meeting, a start time separate
from the posted time (the board shows when something was *posted*, not when it
*starts*), calendar integration, notifications, providers beyond Zoom and Meet,
or a moderator override.

## Trade-offs to state plainly when handing this over

- **No moderator override.** If someone posts something that should come down
  and is unreachable, nobody can remove it before it expires — worst case 2
  days. An admin token checked alongside the owner check is the obvious fix.
- **Identity is per browser.** Post from a laptop, and you cannot remove it from
  a phone. Clearing cookies has the same effect.
- **Meetings from one browser share an `owner` value**, so a viewer can tell
  that several meetings came from the same person, though not who.
- **The board is unauthenticated.** Anyone who can reach the URL can post. It
  belongs behind company SSO or on an internal network.
