// The whole API: list, post and remove meetings, stored in one Netlify Blob.
//
// The board is a single blob rather than one blob per meeting so that a poll
// costs exactly one read, however many people are watching. Writes are rare by
// comparison, so they use a conditional write (optimistic locking) and retry —
// two people posting at the same instant can never overwrite each other.

import { getStore } from "@netlify/blobs";
import { purgeCache } from "@netlify/functions";
import { createHash, randomUUID } from "node:crypto";

import { validateLink, validateTitle } from "../../public/validate.js";

export const config = {
	path: ["/api/meetings", "/api/meetings/:id"]
};

const BOARD_KEY = "board";
const CACHE_TAG = "meetings";
const MAX_MEETINGS = 300;
const WRITE_ATTEMPTS = 5;
const POSTS_PER_MINUTE = 20;

const board = () => getStore({ name: "meetings", consistency: "strong" });

/**
 * @param {unknown} body
 * @param {number} status
 * @param {Record<string, string>} [headers]
 */
function json(body, status = 200, headers = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
			...headers
		}
	});
}

/** An ETag for the board's current contents, so unchanged polls cost nothing. */
const tag = (body) => `W/"${createHash("sha1").update(body).digest("base64url")}"`;

async function readBoard(store) {
	const entry = await store.getWithMetadata(BOARD_KEY, { type: "json" });
	return {
		meetings: Array.isArray(entry?.data) ? entry.data : [],
		// Present in production; the local sandbox omits it, so writes fall back
		// to last-write-wins rather than failing.
		etag: entry?.etag,
		exists: entry != null
	};
}

/**
 * Read, apply `change`, write it back, and make sure the change actually stuck
 * even if someone on the other side of the company posted at the same instant.
 *
 * Netlify Blobs hands back an ETag, so the write is conditional on nobody
 * having written since we read. The local dev sandbox does not return ETags;
 * there the write is unconditional and `verify` re-reads to confirm it was not
 * clobbered. Either way a lost write turns into a retry, never a lost meeting.
 *
 * @param {(meetings: any[]) => any[] | null} change returns null to abort
 * @param {(meetings: any[]) => boolean} [verify] is the change visible afterwards?
 */
async function updateBoard(change, verify) {
	const store = board();

	for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
		const { meetings, etag, exists } = await readBoard(store);
		const next = change(meetings);
		if (next == null)
			return { ok: false };

		const condition = !exists
			? { onlyIfNew: true }
			: etag != null ? { onlyIfMatch: etag } : {};

		const result = await store.setJSON(BOARD_KEY, next, condition);

		// A conditional write that did not modify anything means someone got in
		// first: read again and reapply the change to their version.
		if (!result.modified)
			continue;

		if (etag == null && exists && verify != null) {
			const { meetings: saved } = await readBoard(store);
			if (!verify(saved))
				continue;
		}

		return { ok: true, meetings: next };
	}

	throw new Error("The board is busy; the write kept being beaten by another post.");
}

/**
 * Per-IP throttle. Serverless instances come and go, so the counter lives in a
 * blob rather than in memory. If the limiter itself fails, the post is allowed:
 * losing a meeting matters more than an over-eager limit.
 * @param {string} ip
 */
async function withinRateLimit(ip) {
	const key = `rate/${createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;
	const store = getStore({ name: "meeting-rate-limits", consistency: "strong" });
	const now = Date.now();

	try {
		const entry = await store.getWithMetadata(key, { type: "json" });
		const window = entry?.data;

		if (window == null || now > window.resetAt) {
			await store.setJSON(key, { count: 1, resetAt: now + 60_000 });
			return true;
		}
		if (window.count >= POSTS_PER_MINUTE)
			return false;

		await store.setJSON(key, { count: window.count + 1, resetAt: window.resetAt });
		return true;
	} catch (err) {
		console.error("Rate limit check failed, allowing the post:", err);
		return true;
	}
}

/** @param {Request} req */
/**
 * Everyone sees the same board, so the answer is cached at Netlify's edge and
 * purged the moment someone posts. Thousands of people polling every 15s then
 * cost a handful of function runs rather than one run per person per poll.
 */
const LIST_HEADERS = {
	"content-type": "application/json; charset=utf-8",
	// The browser always asks; the CDN, not the function, usually answers.
	"cache-control": "no-store",
	"netlify-cdn-cache-control": "public, max-age=15, stale-while-revalidate=60, durable",
	"netlify-cache-tag": CACHE_TAG
};

async function listMeetings(req) {
	const { meetings } = await readBoard(board());
	const body = JSON.stringify({ meetings });
	const current = tag(body);

	// The page polls every 15s; an unchanged board answers with an empty 304.
	if (req.headers.get("if-none-match") === current)
		return new Response(null, { status: 304, headers: { ...LIST_HEADERS, etag: current } });

	return new Response(body, { status: 200, headers: { ...LIST_HEADERS, etag: current } });
}

/** Drop the edge copy so a new meeting is visible on the very next poll. */
async function refreshEdge() {
	try {
		await purgeCache({ tags: [CACHE_TAG] });
	} catch (err) {
		// Not fatal: without a purge the board is at most 15s behind.
		console.error("Cache purge failed:", err);
	}
}

/**
 * @param {Request} req
 * @param {any} context
 */
async function postMeeting(req, context) {
	const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
	if (!(await withinRateLimit(ip)))
		return json({ error: "That's a lot of meetings at once — try again in a minute." }, 429);

	let payload;
	try {
		payload = await req.json();
	} catch {
		return json({ error: "Expected a JSON body." }, 400);
	}

	const title = validateTitle(payload?.title);
	if (!title.ok)
		return json({ error: title.error }, 400);

	const link = validateLink(payload?.link);
	if (!link.ok)
		return json({ error: link.error }, 400);

	const meeting = {
		id: randomUUID(),
		title: title.title,
		link: link.link,
		provider: link.provider,
		createdAt: new Date().toISOString()
	};

	await updateBoard(
		// Filtering by id first makes the change safe to apply more than once,
		// so a retry can never leave the same meeting on the board twice.
		(meetings) => [meeting, ...meetings.filter((m) => m.id !== meeting.id)].slice(0, MAX_MEETINGS),
		(saved) => saved.some((m) => m.id === meeting.id)
	);

	await refreshEdge();
	return json({ meeting }, 201);
}

/**
 * Removing is idempotent: if someone else got there first that is still a
 * success. It also keeps the API off 404, which Netlify treats as "not handled
 * here" and retries against the static files.
 * @param {string} id
 */
async function removeMeeting(id) {
	const result = await updateBoard(
		(meetings) => {
			const next = meetings.filter((m) => m.id !== id);
			return next.length === meetings.length ? null : next;
		},
		(saved) => !saved.some((m) => m.id === id)
	);

	if (result.ok)
		await refreshEdge();

	return json({ ok: true, removed: result.ok });
}

/**
 * @param {Request} req
 * @param {any} context
 */
export default async function handler(req, context) {
	const id = context?.params?.id;

	try {
		if (req.method === "GET" && id == null)
			return await listMeetings(req);

		if (req.method === "POST" && id == null)
			return await postMeeting(req, context);

		if (req.method === "DELETE" && id != null)
			return await removeMeeting(id);

		return json({ error: "Method not allowed" }, 405);
	} catch (err) {
		console.error("Request failed:", err);
		return json({ error: "Something went wrong on our side. Please try again." }, 500);
	}
}
