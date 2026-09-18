// The stored board, shared by the API and the scheduled cleanup.
//
// It lives in a single Netlify Blob rather than one blob per meeting, so a poll
// costs exactly one read however many people are watching. Writes are rare by
// comparison, so they use a conditional write and retry.

import { getStore } from "@netlify/blobs";
import { purgeCache } from "@netlify/functions";

import { MAX_EXPIRY_MS } from "../public/validate.js";

export const BOARD_KEY = "board";
export const CACHE_TAG = "meetings";
export const MAX_MEETINGS = 300;

const WRITE_ATTEMPTS = 5;

export const boardStore = () => getStore({ name: "meetings", consistency: "strong" });

/**
 * When a meeting drops off. Entries stored before expiry existed fall back to
 * the two-day maximum; anything without a usable date is treated as expired.
 */
export function expiresAt(meeting) {
	const explicit = Date.parse(meeting?.expiresAt ?? "");
	if (Number.isFinite(explicit))
		return explicit;

	const created = Date.parse(meeting?.createdAt ?? "");
	return Number.isFinite(created) ? created + MAX_EXPIRY_MS : 0;
}

export const isLive = (meeting, now = Date.now()) => expiresAt(meeting) > now;

export async function readBoard(store) {
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
 * Read, drop anything expired, apply `change`, write it back, and make sure the
 * change stuck even if someone on the other side of the company posted at the
 * same instant.
 *
 * Netlify Blobs hands back an ETag, so the write is conditional on nobody
 * having written since we read. The local dev sandbox does not return ETags;
 * there the write is unconditional and `verify` re-reads to confirm it was not
 * clobbered. Either way a lost write turns into a retry, never a lost meeting.
 *
 * @param {(live: any[], all: any[]) => any[] | null} change returns null to abort
 * @param {(meetings: any[]) => boolean} [verify] is the change visible afterwards?
 */
export async function updateBoard(change, verify) {
	const store = boardStore();

	for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
		const { meetings, etag, exists } = await readBoard(store);
		const now = Date.now();
		const live = meetings.filter((meeting) => isLive(meeting, now));

		const next = change(live, meetings);
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

/** Drop the edge copy so a change is visible on the very next poll. */
export async function refreshEdge() {
	try {
		await purgeCache({ tags: [CACHE_TAG] });
	} catch (err) {
		// Not fatal: without a purge the board is at most 15s behind.
		console.error("Cache purge failed:", err);
	}
}
