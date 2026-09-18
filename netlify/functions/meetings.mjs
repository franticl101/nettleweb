// The whole API: list, post and remove meetings.

import { getStore } from "@netlify/blobs";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
	CACHE_TAG,
	MAX_MEETINGS,
	boardStore,
	isLive,
	readBoard,
	refreshEdge,
	updateBoard
} from "../board.mjs";
import { validateExpiry, validateLink, validateTitle } from "../../public/validate.js";

export const config = {
	path: ["/api/meetings", "/api/meetings/:id"]
};

const POSTS_PER_MINUTE = 20;
const YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * Two cookies, set together:
 *   mb_token  the secret, HttpOnly — proves you posted a meeting
 *   mb_id     sha256 of that secret, readable — lets the page know which rows
 *             are yours so it can show a remove button
 *
 * Only the secret authorises anything. Forging mb_id shows you a button that
 * the server then refuses, and because mb_id is what the board stores, the
 * shared list of meetings stays identical for everyone and cacheable at the
 * edge.
 */
const TOKEN_COOKIE = "mb_token";
const ID_COOKIE = "mb_id";

const publicId = (token) => createHash("sha256").update(token).digest("hex").slice(0, 32);

/** @param {Request} req */
function cookies(req) {
	const jar = new Map();

	for (const part of (req.headers.get("cookie") || "").split(";")) {
		const at = part.indexOf("=");
		if (at > 0)
			jar.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
	}

	return jar;
}

/** @param {Request} req */
function identify(req) {
	const token = cookies(req).get(TOKEN_COOKIE);
	if (token != null && token.length >= 32)
		return { token, id: publicId(token), known: true };

	const fresh = randomBytes(32).toString("hex");
	return { token: fresh, id: publicId(fresh), known: false };
}

/** @param {Request} req */
function identityCookies(req, identity) {
	// Netlify serves https; local `netlify dev` does not, and a Secure cookie
	// would simply never be stored there.
	const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
	const shared = `Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax${secure}`;

	return [
		`${TOKEN_COOKIE}=${identity.token}; HttpOnly; ${shared}`,
		`${ID_COOKIE}=${identity.id}; ${shared}`
	];
}

/**
 * @param {unknown} body
 * @param {number} status
 * @param {{ headers?: Record<string, string>, setCookie?: string[] }} [extra]
 */
function json(body, status = 200, extra = {}) {
	const headers = new Headers({
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		...extra.headers
	});

	for (const cookie of extra.setCookie || [])
		headers.append("set-cookie", cookie);

	return new Response(JSON.stringify(body), { status, headers });
}

/** An ETag for the board's current contents, so unchanged polls cost nothing. */
const tag = (body) => `W/"${createHash("sha1").update(body).digest("base64url")}"`;

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

/** @param {Request} req */
async function listMeetings(req) {
	const { meetings } = await readBoard(boardStore());
	const now = Date.now();

	// Expired meetings are never served, whatever the cleanup has got round to.
	const body = JSON.stringify({ meetings: meetings.filter((m) => isLive(m, now)) });
	const current = tag(body);

	// The page polls every 15s; an unchanged board answers with an empty 304.
	if (req.headers.get("if-none-match") === current)
		return new Response(null, { status: 304, headers: { ...LIST_HEADERS, etag: current } });

	return new Response(body, { status: 200, headers: { ...LIST_HEADERS, etag: current } });
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

	const expiry = validateExpiry(payload?.expiresAt);
	if (!expiry.ok)
		return json({ error: expiry.error }, 400);

	const identity = identify(req);
	const meeting = {
		id: randomUUID(),
		title: title.title,
		link: link.link,
		provider: link.provider,
		owner: identity.id,
		createdAt: new Date().toISOString(),
		expiresAt: expiry.expiresAt
	};

	await updateBoard(
		// Filtering by id first makes the change safe to apply more than once,
		// so a retry can never leave the same meeting on the board twice.
		(live) => [meeting, ...live.filter((m) => m.id !== meeting.id)].slice(0, MAX_MEETINGS),
		(saved) => saved.some((m) => m.id === meeting.id)
	);

	await refreshEdge();
	return json({ meeting }, 201, { setCookie: identityCookies(req, identity) });
}

/**
 * Only whoever posted a meeting can take it down, proven by the secret cookie.
 * Removing is otherwise idempotent: if it is already gone, or has expired, that
 * is still a success.
 *
 * The outcome is in the body at 200, including a refusal. Netlify retries a
 * function's 403 and 404 against the static files ("mimic the CDN behavior"),
 * so a path-routed function that answers with either has its answer replaced
 * by whatever that retry returns.
 *
 * @param {Request} req
 * @param {string} id
 */
async function removeMeeting(req, id) {
	const token = cookies(req).get(TOKEN_COOKIE);
	const owner = token == null ? null : publicId(token);
	let denied = false;

	const result = await updateBoard(
		(live) => {
			const target = live.find((m) => m.id === id);
			if (target == null)
				return null;

			if (target.owner == null || target.owner !== owner) {
				denied = true;
				return null;
			}

			return live.filter((m) => m.id !== id);
		},
		(saved) => !saved.some((m) => m.id === id)
	);

	if (denied)
		return json({ ok: false, removed: false, error: "Only the person who posted this meeting can remove it." });

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
			return await removeMeeting(req, id);

		return json({ error: "Method not allowed" }, 405);
	} catch (err) {
		console.error("Request failed:", err);
		return json({ error: "Something went wrong on our side. Please try again." }, 500);
	}
}
