import { MAX_EXPIRY_MS, MAX_TITLE_WORDS, validateExpiry, validateLink, validateTitle } from "/validate.js";

const POLL_MS = 15_000;
const NEW_FOR_MS = 20_000;

const el = {
	form: document.getElementById("form"),
	title: document.getElementById("title"),
	link: document.getElementById("link"),
	counter: document.getElementById("counter"),
	detect: document.getElementById("detect"),
	submit: document.getElementById("submit"),
	postKey: document.getElementById("postKey"),
	message: document.getElementById("message"),
	results: document.getElementById("results"),
	empty: document.getElementById("empty"),
	emptyTitle: document.querySelector(".empty-title"),
	emptyNote: document.querySelector(".empty-note"),
	expiry: document.querySelector(".expiry"),
	expiryAt: document.getElementById("expiryAt"),
	expiryHint: document.getElementById("expiryHint"),
	search: document.getElementById("search"),
	greeting: document.getElementById("greeting"),
	live: document.getElementById("live"),
	liveText: document.getElementById("liveText"),
	announcer: document.getElementById("announcer")
};

const state = {
	expiry: "today",
	meetings: [],
	etag: null,
	filter: "all",
	query: "",
	online: true,
	loaded: false,
	/** id -> the moment it first appeared here, so arrivals can be highlighted */
	arrivals: new Map()
};

let timer = null;

const PROVIDERS = {
	zoom: { label: "Zoom", icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="13" height="12" rx="3.5"/><path d="M15 11l6-4v10l-6-4"/></svg>` },
	meet: { label: "Google Meet", icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a3 3 0 013-3h6a3 3 0 013 3v8a3 3 0 01-3 3H6a3 3 0 01-3-3z"/><path d="M15 10.5L21 7v10l-6-3.5"/></svg>` }
};

const ICONS = {
	copy: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M6 15H5a2 2 0 01-2-2V5a2 2 0 012-2h8a2 2 0 012 2v1"/></svg>`,
	check: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>`,
	remove: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`
};

/* Helpers ------------------------------------------------------------------ */

function countWords(value) {
	const trimmed = value.trim();
	return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Today's meetings read as freshness ("12 min ago"); older ones read as a
 * clock time, because the day heading above them already says which day. A
 * rounded "2 days ago" under a "Yesterday" heading is just confusing.
 */
function postedLabel(iso, group) {
	// "2:21 AM" on its own would sit next to the expiry time and read as one of
	// a pair of unlabelled clocks, so say which one it is.
	if (group !== "Today")
		return `posted ${new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;

	const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
	if (minutes < 1) return "just now";
	if (minutes === 1) return "1 min ago";
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.floor(minutes / 60);
	return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

function exactTime(iso) {
	return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** The part of the link people recognise: the room code or meeting number. */
function meetingCode(meeting) {
	try {
		const url = new URL(meeting.link);
		if (meeting.provider === "meet")
			return url.pathname.slice(1).split("/").pop() || "";

		const digits = url.pathname.match(/\/(?:j|s|w)\/(\d{6,})/);
		if (digits == null)
			return "";

		// Zoom writes ids the way it shows them: 844 5566 7788, 844 556 7788.
		const id = digits[1];
		if (id.length === 11)
			return `${id.slice(0, 3)} ${id.slice(3, 7)} ${id.slice(7)}`;
		if (id.length === 10)
			return `${id.slice(0, 3)} ${id.slice(3, 6)} ${id.slice(6)}`;
		return id;
	} catch {
		return "";
	}
}

/**
 * One heading per day, so a busy board stays scannable and every row's time is
 * unambiguous: the heading says which day, the row says when.
 */
function dayGroup(iso) {
	const posted = new Date(iso);
	const postedDay = new Date(posted);
	postedDay.setHours(0, 0, 0, 0);

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const days = Math.round((today - postedDay) / 86_400_000);
	if (days <= 0) return "Today";
	if (days === 1) return "Yesterday";
	if (days < 7) return posted.toLocaleDateString(undefined, { weekday: "long" });
	return posted.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** The chip presets, as absolute times. Everything is capped at two days. */
function presetExpiry(preset, now = new Date()) {
	if (preset === "4h")
		return new Date(now.getTime() + 4 * 60 * 60 * 1000);

	const endOf = (date) => {
		const end = new Date(date);
		end.setHours(23, 59, 0, 0);
		return end;
	};

	if (preset === "tomorrow")
		return endOf(new Date(now.getTime() + 86_400_000));

	return endOf(now);
}

/** A datetime-local value ("2026-09-18T17:30") for the given moment. */
function localInputValue(date) {
	const pad = (n) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The expiry the composer currently describes, as an ISO timestamp. */
function chosenExpiry() {
	if (state.expiry !== "custom")
		return presetExpiry(state.expiry).toISOString();

	const at = new Date(el.expiryAt.value);
	return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

function describeExpiry() {
	const iso = chosenExpiry();
	if (iso == null) {
		el.expiryHint.textContent = "Pick a date and time, at most 2 days from now.";
		return;
	}

	const at = new Date(iso);
	const sameDay = at.toDateString() === new Date().toDateString();
	const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
	const day = sameDay ? "" : ` ${at.toLocaleDateString(undefined, { weekday: "long" })}`;
	el.expiryHint.textContent = `Stays on the board until${day} ${time}.`;
}

/**
 * How long a meeting has left. Always rounded down: a deadline that overstates
 * the time remaining is worse than one that understates it.
 */
function remainingLabel(meeting) {
	const left = Date.parse(meeting.expiresAt) - Date.now();
	if (left <= 0) return "expired";
	if (left < 60_000) return "expires in under a minute";

	const minutes = Math.floor(left / 60_000);
	if (minutes < 60) return `expires in ${minutes} min`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return hours === 1 ? "expires in 1 hour" : `expires in ${hours} hours`;

	const at = new Date(meeting.expiresAt);
	return `expires ${at.toLocaleDateString(undefined, { weekday: "short" })} ${at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

const expiringSoon = (meeting) => Date.parse(meeting.expiresAt) - Date.now() < 60 * 60 * 1000;

/** The readable half of the identity cookie pair; the secret is HttpOnly. */
function myOwnerId() {
	for (const part of document.cookie.split(";")) {
		const [name, value] = part.split("=");
		if (name?.trim() === "mb_id")
			return value?.trim() || null;
	}
	return null;
}

function greeting() {
	const hour = new Date().getHours();
	if (hour < 12) return "Good morning";
	if (hour < 18) return "Good afternoon";
	return "Good evening";
}

function setMessage(text, kind) {
	el.message.textContent = text || "";
	el.message.hidden = !text;
	el.message.className = `message ${text ? `is-${kind}` : ""}`.trim();
}

function setOnline(online) {
	if (state.online === online)
		return;

	state.online = online;
	el.live.classList.toggle("is-offline", !online);
	el.liveText.textContent = online ? "Live" : "Reconnecting";
}

/* Rendering ---------------------------------------------------------------- */

/** Rows vanish the moment they expire, without waiting for the next poll. */
function liveMeetings() {
	const now = Date.now();
	return state.meetings.filter((meeting) => Date.parse(meeting.expiresAt) > now);
}

function visibleMeetings() {
	const query = state.query.trim().toLowerCase();

	return liveMeetings().filter((meeting) => {
		if (state.filter !== "all" && meeting.provider !== state.filter)
			return false;
		return query === "" || meeting.title.toLowerCase().includes(query);
	});
}

function meetingRow(meeting, group) {
	const provider = PROVIDERS[meeting.provider] || PROVIDERS.zoom;
	const arrived = state.arrivals.get(meeting.id);
	const isNew = arrived != null && Date.now() - arrived < NEW_FOR_MS;

	const item = document.createElement("li");
	item.className = isNew ? "item is-new" : "item";

	const avatar = document.createElement("span");
	avatar.className = "avatar";
	avatar.dataset.provider = meeting.provider;
	avatar.innerHTML = provider.icon;

	const info = document.createElement("div");
	info.className = "info";

	const titleRow = document.createElement("div");
	titleRow.className = "title-row";

	const title = document.createElement("span");
	title.className = "title";
	title.textContent = meeting.title;
	titleRow.append(title);

	if (isNew) {
		const badge = document.createElement("span");
		badge.className = "badge";
		badge.textContent = "New";
		titleRow.append(badge);
	}

	const meta = document.createElement("div");
	meta.className = "meta";
	meta.append(provider.label);

	const code = meetingCode(meeting);
	if (code !== "") {
		const sep = document.createElement("span");
		sep.className = "sep";
		sep.textContent = "·";
		const codeEl = document.createElement("span");
		codeEl.className = "code";
		codeEl.textContent = code;
		meta.append(sep, codeEl);
	}

	const sep2 = document.createElement("span");
	sep2.className = "sep";
	sep2.textContent = "·";
	const when = document.createElement("span");
	when.textContent = postedLabel(meeting.createdAt, group);
	when.title = `Posted ${exactTime(meeting.createdAt)}`;

	const sep3 = document.createElement("span");
	sep3.className = "sep";
	sep3.textContent = "·";
	const expiry = document.createElement("span");
	expiry.className = expiringSoon(meeting) ? "expires is-soon" : "expires";
	expiry.textContent = remainingLabel(meeting);
	expiry.title = `Comes off the board ${exactTime(meeting.expiresAt)}`;

	meta.append(sep2, when, sep3, expiry);

	info.append(titleRow, meta);

	const join = document.createElement("a");
	join.className = "join";
	join.href = meeting.link;
	join.target = "_blank";
	join.rel = "noopener noreferrer";
	join.textContent = "Join";
	join.setAttribute("aria-label", `Join ${meeting.title} on ${provider.label}`);

	const copy = document.createElement("button");
	copy.type = "button";
	copy.className = "icon-btn";
	copy.title = "Copy link";
	copy.setAttribute("aria-label", `Copy the link to ${meeting.title}`);
	copy.innerHTML = ICONS.copy;
	copy.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(meeting.link);
			copy.innerHTML = ICONS.check;
			copy.classList.add("is-done");
			setTimeout(() => {
				copy.innerHTML = ICONS.copy;
				copy.classList.remove("is-done");
			}, 1400);
		} catch {
			window.prompt("Copy this link:", meeting.link);
		}
	});

	item.append(avatar, info, join, copy);

	// Only the person who posted it can take it down, so only they get the
	// button. The server checks the secret cookie regardless of what is shown.
	if (meeting.owner != null && meeting.owner === myOwnerId()) {
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "icon-btn remove";
		remove.title = "Remove — you posted this";
		remove.setAttribute("aria-label", `Remove ${meeting.title} from the board`);
		remove.innerHTML = ICONS.remove;
		remove.addEventListener("click", () => removeMeeting(meeting, remove));
		item.append(remove);
	}

	return item;
}

function skeletons(count = 3) {
	return Array.from({ length: count }, () => {
		const row = document.createElement("div");
		row.className = "skeleton";
		row.setAttribute("aria-hidden", "true");
		row.innerHTML = `<span class="s-avatar"></span><span class="s-body"><span class="s-title"></span><span class="s-meta"></span></span>`;
		return row;
	});
}

function updateTallies() {
	const live = liveMeetings();
	const counts = { all: live.length, zoom: 0, meet: 0 };
	for (const meeting of live)
		counts[meeting.provider] = (counts[meeting.provider] || 0) + 1;

	for (const [name, value] of Object.entries(counts)) {
		const target = document.querySelector(`[data-tally="${name}"]`);
		if (target != null)
			target.textContent = String(value);
	}
}

function render() {
	el.greeting.textContent = greeting();
	updateTallies();

	if (!state.loaded) {
		el.results.replaceChildren(...skeletons());
		el.empty.hidden = true;
		return;
	}

	const meetings = visibleMeetings();
	el.results.replaceChildren();

	let group = null;
	let list = null;

	for (const meeting of meetings) {
		const name = dayGroup(meeting.createdAt);
		if (name !== group) {
			group = name;
			const heading = document.createElement("h3");
			heading.className = "group";
			heading.textContent = name;
			list = document.createElement("ul");
			list.className = "list";
			el.results.append(heading, list);
		}
		list.append(meetingRow(meeting, name));
	}

	el.empty.hidden = meetings.length > 0;
	const filtered = liveMeetings().length > 0;
	el.emptyTitle.textContent = filtered ? "Nothing matches" : "The board is clear";
	el.emptyNote.textContent = filtered
		? "Try another search, or switch back to All."
		: "Share the first meeting — everyone else sees it within 15 seconds.";
}

/* Data --------------------------------------------------------------------- */

function noteArrivals(meetings) {
	const known = state.arrivals;
	const first = !state.loaded;
	let fresh = 0;

	for (const meeting of meetings) {
		if (known.has(meeting.id))
			continue;

		// On the very first load nothing is "new" — the board is simply there.
		known.set(meeting.id, first ? 0 : Date.now());
		if (!first)
			fresh++;
	}

	const ids = new Set(meetings.map((m) => m.id));
	for (const id of known.keys()) {
		if (!ids.has(id))
			known.delete(id);
	}

	if (fresh > 0)
		el.announcer.textContent = fresh === 1 ? "1 new meeting on the board" : `${fresh} new meetings on the board`;
}

async function poll() {
	try {
		const headers = state.etag == null ? {} : { "if-none-match": state.etag };
		const res = await fetch("/api/meetings", { headers, cache: "no-store" });

		setOnline(true);

		// 304: nobody has posted since the last poll, so there is nothing to do.
		if (res.status === 304)
			return;
		if (!res.ok)
			return;

		const data = await res.json();
		const meetings = Array.isArray(data.meetings) ? data.meetings : [];

		noteArrivals(meetings);
		state.etag = res.headers.get("etag");
		state.meetings = meetings;
		state.loaded = true;
		render();
	} catch {
		setOnline(false);
	}
}

function startPolling() {
	stopPolling();
	timer = setInterval(poll, POLL_MS);
}

function stopPolling() {
	if (timer != null) {
		clearInterval(timer);
		timer = null;
	}
}

async function removeMeeting(meeting, button) {
	if (!window.confirm(`Remove “${meeting.title}” from the board?`))
		return;

	button.disabled = true;
	try {
		const res = await fetch(`/api/meetings/${meeting.id}`, { method: "DELETE" });
		const data = await res.json().catch(() => ({}));

		// A refusal comes back as ok:false at 200 — see the note in the function.
		if (!res.ok || data.ok === false) {
			button.disabled = false;
			setMessage(data.error || "That meeting could not be removed. Try again in a moment.", "error");
			return;
		}

		state.meetings = state.meetings.filter((m) => m.id !== meeting.id);
		state.arrivals.delete(meeting.id);
		state.etag = null;
		render();
	} catch {
		button.disabled = false;
		setOnline(false);
	}
}

/* Events ------------------------------------------------------------------- */

el.title.addEventListener("input", () => {
	const words = countWords(el.title.value);
	el.counter.textContent = `${words} of ${MAX_TITLE_WORDS} words`;
	el.counter.classList.toggle("over", words > MAX_TITLE_WORDS);
});

el.link.addEventListener("input", () => {
	const result = validateLink(el.link.value);
	el.detect.hidden = !result.ok;
	if (result.ok) {
		el.detect.dataset.provider = result.provider;
		el.detect.textContent = PROVIDERS[result.provider].label;
	}
});

el.search.addEventListener("input", () => {
	state.query = el.search.value;
	render();
});

for (const chip of document.querySelectorAll(".filters .chip")) {
	chip.addEventListener("click", () => {
		state.filter = chip.dataset.filter;
		for (const other of document.querySelectorAll(".filters .chip")) {
			const active = other === chip;
			other.classList.toggle("is-active", active);
			other.setAttribute("aria-pressed", String(active));
		}
		render();
	});
}

function selectExpiry(preset) {
	state.expiry = preset;

	for (const chip of document.querySelectorAll(".expiry .chip")) {
		const active = chip.dataset.expiry === preset;
		chip.classList.toggle("is-active", active);
		chip.setAttribute("aria-checked", String(active));
	}

	el.expiryAt.hidden = preset !== "custom";
	if (preset === "custom" && el.expiryAt.value === "")
		el.expiryAt.value = localInputValue(presetExpiry("today"));

	describeExpiry();
}

for (const chip of document.querySelectorAll(".expiry .chip"))
	chip.addEventListener("click", () => selectExpiry(chip.dataset.expiry));

el.expiryAt.addEventListener("input", describeExpiry);

el.form.addEventListener("submit", async (event) => {
	event.preventDefault();
	setMessage("");

	const title = validateTitle(el.title.value);
	if (!title.ok) {
		setMessage(title.error, "error");
		el.title.focus();
		return;
	}

	const link = validateLink(el.link.value);
	if (!link.ok) {
		setMessage(link.error, "error");
		el.link.focus();
		return;
	}

	const expiry = validateExpiry(chosenExpiry());
	if (!expiry.ok) {
		setMessage(expiry.error, "error");
		if (state.expiry === "custom")
			el.expiryAt.focus();
		return;
	}

	el.submit.disabled = true;
	try {
		const res = await fetch("/api/meetings", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ title: title.title, link: link.link, expiresAt: expiry.expiresAt })
		});
		const data = await res.json();

		if (!res.ok) {
			setMessage(data.error || "That meeting could not be posted.", "error");
			return;
		}

		// Show it straight away; the next poll picks up everyone else's posts.
		state.arrivals.set(data.meeting.id, Date.now());
		state.meetings = [data.meeting, ...state.meetings];
		state.etag = null;
		render();

		el.title.value = "";
		el.link.value = "";
		el.counter.textContent = `0 of ${MAX_TITLE_WORDS} words`;
		el.counter.classList.remove("over");
		el.detect.hidden = true;
		setMessage("Posted — everyone can see it now.", "ok");
		setTimeout(() => setMessage(""), 4000);
	} catch {
		setOnline(false);
		setMessage("We couldn't reach the board. Check your connection and try again.", "error");
	} finally {
		el.submit.disabled = false;
	}
});

// Post without leaving the keyboard, and jump to search with "/".
el.form.addEventListener("keydown", (event) => {
	if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
		el.form.requestSubmit();
});

document.addEventListener("keydown", (event) => {
	const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
	if (event.key === "/" && !typing) {
		event.preventDefault();
		el.search.focus();
	}
});

// Stop polling for tabs nobody is looking at, and catch up on return.
document.addEventListener("visibilitychange", () => {
	if (document.hidden) {
		stopPolling();
		return;
	}
	poll();
	startPolling();
});

window.addEventListener("online", () => poll());
window.addEventListener("offline", () => setOnline(false));

// Keeps "3 min ago", the greeting and the New badges honest between polls.
setInterval(render, 30_000);

if (navigator.platform?.startsWith("Mac") || navigator.userAgent.includes("Mac OS"))
	el.postKey.textContent = "⌘";

el.expiryAt.min = localInputValue(new Date(Date.now() + 60_000));
el.expiryAt.max = localInputValue(new Date(Date.now() + MAX_EXPIRY_MS));

// Late in the evening "end of today" is minutes away, so start on 4 hours.
selectExpiry(presetExpiry("today").getTime() - Date.now() < 60 * 60 * 1000 ? "4h" : "today");

el.counter.textContent = `0 of ${MAX_TITLE_WORDS} words`;
render();
poll();
startPolling();
