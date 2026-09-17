# Meeting board

A minimal, open board where anyone in the company can post a Zoom or Google Meet
link with a short title. No accounts, no login — open the page and post.

## Run it

```sh
npm start          # http://localhost:3000
```

No dependencies: it runs on plain Node 18+.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to bind |
| `DATA_FILE` | `data/meetings.json` | Where meetings are stored |

## Rules

- **Titles** are 10 words or fewer (120 characters max) and required.
- **Links** must be `https://` and on a Zoom host (`zoom.us`, any subdomain such
  as `us02web.zoom.us`, or `zoomgov.com`) or on `meet.google.com`. Anything else
  is rejected, including lookalikes like `zoom.us.example.com`.
- The board keeps the 200 most recent meetings; older ones drop off.
- Anyone can remove any meeting — the board is fully open by design.
- A single IP can post at most 20 meetings a minute.

Both rules are enforced on the server (`src/validate.js`); the browser runs a
lighter copy only so the word counter and errors appear instantly.

## API

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| `GET` | `/api/meetings` | — | `{ meetings: [...] }`, newest first |
| `POST` | `/api/meetings` | `{ "title": "...", "link": "..." }` | `201` with the created meeting, or `400` with `{ error }` |
| `DELETE` | `/api/meetings/:id` | — | `{ ok: true }` |

## Layout

```
src/server.js    HTTP server, routing, static files
src/validate.js  title and link rules
src/store.js     JSON file storage
public/          the page (index.html, style.css, app.js)
```

## Deploying

Run `npm start` behind a reverse proxy that terminates TLS (nginx, Caddy, a
platform like Fly or Render) and keep `data/meetings.json` on a persistent disk.
Because the board has no authentication, put it on your internal network or
behind your company SSO proxy rather than the open internet.
