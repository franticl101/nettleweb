// The rules for what may be posted, in one place. This file is served to the
// browser as a module and is also imported by the Netlify function, which
// bundles it in — so the board and the API can never drift apart.

export const MAX_TITLE_WORDS = 10;
export const MAX_TITLE_CHARS = 120;

/** Nothing may sit on the board for more than two days. */
export const MAX_EXPIRY_MS = 48 * 60 * 60 * 1000;
const MIN_EXPIRY_MS = 60 * 1000;
/** Browser clocks drift; do not reject someone for being a few minutes fast. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const ZOOM_HOSTS = /^(?:[a-z0-9-]+\.)*zoom\.us$/;
const ZOOMGOV_HOSTS = /^(?:[a-z0-9-]+\.)*zoomgov\.com$/;
const MEET_HOST = "meet.google.com";

/**
 * @param {unknown} value
 * @returns {{ ok: true, title: string } | { ok: false, error: string }}
 */
export function validateTitle(value) {
	if (typeof value !== "string")
		return { ok: false, error: "Title is required." };

	const title = value.trim().replace(/\s+/g, " ");
	if (title.length === 0)
		return { ok: false, error: "Title is required." };
	if (title.length > MAX_TITLE_CHARS)
		return { ok: false, error: `Title must be ${MAX_TITLE_CHARS} characters or fewer.` };

	const words = title.split(" ");
	if (words.length > MAX_TITLE_WORDS)
		return { ok: false, error: `Title must be ${MAX_TITLE_WORDS} words or fewer.` };

	return { ok: true, title };
}

/**
 * Accepts Zoom (zoom.us / zoomgov.com) and Google Meet links only.
 * @param {unknown} value
 * @returns {{ ok: true, link: string, provider: "zoom" | "meet" } | { ok: false, error: string }}
 */
export function validateLink(value) {
	if (typeof value !== "string" || value.trim().length === 0)
		return { ok: false, error: "Link is required." };

	const raw = value.trim();
	let url;

	try {
		url = new URL(raw.includes("://") ? raw : `https://${raw}`);
	} catch {
		return { ok: false, error: "That is not a valid link." };
	}

	if (url.protocol !== "https:")
		return { ok: false, error: "Link must start with https://" };

	const host = url.hostname.toLowerCase();

	if (host === MEET_HOST) {
		if (url.pathname.length <= 1)
			return { ok: false, error: "Google Meet link is missing its meeting code." };
		return { ok: true, link: url.toString(), provider: "meet" };
	}

	if (ZOOM_HOSTS.test(host) || ZOOMGOV_HOSTS.test(host)) {
		if (url.pathname.length <= 1)
			return { ok: false, error: "Zoom link is missing its meeting path." };
		return { ok: true, link: url.toString(), provider: "zoom" };
	}

	return { ok: false, error: "Only Zoom and Google Meet links can be posted." };
}

/**
 * When the meeting should drop off the board. Leaving it out means the maximum.
 * @param {unknown} value an ISO timestamp
 * @param {number} [now]
 * @returns {{ ok: true, expiresAt: string } | { ok: false, error: string }}
 */
export function validateExpiry(value, now = Date.now()) {
	if (value == null || value === "")
		return { ok: true, expiresAt: new Date(now + MAX_EXPIRY_MS).toISOString() };

	if (typeof value !== "string")
		return { ok: false, error: "That expiry time is not a valid date." };

	const at = Date.parse(value);
	if (!Number.isFinite(at))
		return { ok: false, error: "That expiry time is not a valid date." };

	if (at < now + MIN_EXPIRY_MS)
		return { ok: false, error: "Pick a time at least a minute from now." };

	if (at > now + MAX_EXPIRY_MS + CLOCK_SKEW_MS)
		return { ok: false, error: "Meetings can stay on the board for at most 2 days." };

	// A clock a little fast is clamped rather than refused.
	return { ok: true, expiresAt: new Date(Math.min(at, now + MAX_EXPIRY_MS)).toISOString() };
}
