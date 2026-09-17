# Meeting Board

An open board for a whole company: post a Zoom or Google Meet link with a short
title and everyone else sees it within 15 seconds. No accounts, no invites.

Static page on Netlify, one Netlify Function for the API, Netlify Blobs for
storage. Nothing else to run.

## Local development

```sh
npm install
npm run dev        # netlify dev → http://localhost:8888
```

`netlify dev` serves `public/`, runs the function, and emulates Blobs on disk.

## Deploying to Netlify

1. Connect this repository to a Netlify site (or `netlify deploy`).
2. Nothing to configure: `netlify.toml` publishes `public/` and picks up the
   function. Blobs needs no setup on a linked site.

## How it behaves

- **Titles** are required and 10 words or fewer (120 characters max).
- **Links** must be `https://` and on a Zoom host (`zoom.us`, any subdomain such
  as `us02web.zoom.us`, or `zoomgov.com`) or on `meet.google.com`. Lookalikes
  like `zoom.us.example.com` are rejected.
- The board holds the 300 most recent meetings.
- Anyone can post and anyone can remove — the board is open by design.
- One IP can post 20 meetings a minute.

The rules live in `public/validate.js`, which the browser loads as a module and
the function bundles in, so the page and the API can never disagree.

## How it holds up with everyone watching

- **Polling is cheap.** The page asks `/api/meetings` every 15 seconds and sends
  the ETag it already has. An unchanged board answers `304` with no body.
- **The edge does the work.** The list is cached at Netlify's CDN for 15 seconds
  (`Netlify-CDN-Cache-Control`) and tagged `meetings`. Posting or removing purges
  that tag, so a new meeting is visible on the very next poll. Without this,
  thousands of people polling every 15s would be millions of function runs a day;
  with it, the function only runs on a cache miss.
- **Tabs nobody is looking at stop polling** and catch up when they come back.
- **Simultaneous posts don't collide.** The board is a single blob, so a poll is
  one read. Writes re-read, apply the change and write conditionally on the
  blob's ETag (`onlyIfMatch`), retrying if someone got in first.

## The page

- **The board comes first.** The composer is one compact row, so meetings are
  visible without scrolling on a laptop and on a phone.
- **One heading per day**, pinned while you scroll. Today's meetings read as
  freshness ("12 min ago"); older ones show a clock time, because the heading
  above already says which day.
- **Arrivals are marked.** Anything that appears via polling is outlined and
  badged New for 20 seconds, and announced to screen readers. Nothing is marked
  new on first load — the board is simply there.
- **Filters carry their counts**, so "Zoom 7" says how much is behind it.
- Skeleton rows on first paint, `/` to search, Ctrl/⌘+Enter to post, a copy
  button per row, and the Zoom id shown the way Zoom writes it (844 5566 7788).
- Every text pair clears WCAG AA in both themes (measured: 5.9–8.4:1), touch
  targets are 42px on phones, and everything respects reduced motion.

Inter is served from `public/fonts/` rather than a font CDN — one less third
party, and it still renders correctly on a network that blocks one. It is
licensed under the SIL Open Font License 1.1 (`public/fonts/OFL.txt`).

## Layout

```
netlify/functions/meetings.mjs   the API: list, post, remove
public/validate.js               the posting rules, shared with the browser
public/index.html, style.css, app.js
public/fonts/                    self-hosted Inter subset + licence
netlify.toml                     publish dir, function dir, headers
```

## API

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| `GET` | `/api/meetings` | — | `{ meetings: [...] }` newest first, with an `ETag`; `304` when unchanged |
| `POST` | `/api/meetings` | `{ "title": "...", "link": "..." }` | `201` with the meeting, or `400` with `{ error }` |
| `DELETE` | `/api/meetings/:id` | — | `{ ok: true, removed: boolean }` — removing twice is not an error |

## Known limits

- `netlify dev`'s Blobs sandbox does not return ETags, so two posts in the same
  instant can overwrite each other locally. Deployed sites return ETags and use
  the conditional write, so this does not happen in production.
- There is no authentication at all: anyone who can open the page can post or
  remove anything. Put the site behind your company SSO (Netlify Identity, an
  access-control add-on, or a private network) if the URL will be reachable
  outside the company.
