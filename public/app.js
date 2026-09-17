import { MAX_TITLE_WORDS, validateLink, validateTitle } from "/validate.js";

const POLL_MS = 15_000;

const el = {
	form: document.getElementById("form"),
	title: document.getElementById("title"),
	link: document.getElementById("link"),
	counter: document.getElementById("counter"),
	detect: document.getElementById("detect"),
	submit: document.getElementById("submit"),
	message: document.getElementById("message"),
	list: document.getElementById("list"),
	empty: document.getElementById("empty"),
	count: document.getElementById("count"),
	search: document.getElementById("search"),
	greeting: document.getElementById("greeting"),
	live: document.getElementById("live"),
	liveText: document.getElementById("liveText")
};

const state = {
	meetings: [],
	etag: null,
	filter: "all",
	query: "",
	online: true
};

let timer = null;

const PROVIDERS = {
	zoom: { label: "Zoom", icon: `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="13" height="12" rx="3.5"/><path d="M15 11l6-4v10l-6-4"/></svg>` },
	meet: { label: "Google Meet", icon: `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a3 3 0 013-3h6a3 3 0 013 3v8a3 3 0 01-3 3H6a3 3 0 01-3-3z"/><path d="M15 10.5L21 7v10l-6-3.5"/></svg>` }
};

const ICONS = {
	copy: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M6 15H5a2 2 0 01-2-2V5a2 2 0 012-2h8a2 2 0 012 2v1"/></svg>`,
	check: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>`,
	remove: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`
};

/* Helpers ------------------------------------------------------------------ */

function countWords(value) {
	const trimmed = value.trim();
	return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function relativeTime(iso) {
	const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
	if (minutes < 1) return "just now";
	if (minutes === 1) return "1 minute ago";
	if (minutes < 60) return `${minutes} minutes ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
	const days = Math.round(hours / 24);
	return days === 1 ? "yesterday" : `${days} days ago`;
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

function visibleMeetings() {
	const query = state.query.trim().toLowerCase();

	return state.meetings.filter((meeting) => {
		if (state.filter !== "all" && meeting.provider !== state.filter)
			return false;
		return query === "" || meeting.title.toLowerCase().includes(query);
	});
}

function meetingRow(meeting) {
	const provider = PROVIDERS[meeting.provider] || PROVIDERS.zoom;
	const item = document.createElement("li");
	item.className = "item";

	const avatar = document.createElement("span");
	avatar.className = "avatar";
	avatar.dataset.provider = meeting.provider;
	avatar.innerHTML = provider.icon;

	const info = document.createElement("div");
	info.className = "info";

	const title = document.createElement("span");
	title.className = "title";
	title.textContent = meeting.title;

	const meta = document.createElement("div");
	meta.className = "meta";
	meta.textContent = `${provider.label} · posted ${relativeTime(meeting.createdAt)}`;

	info.append(title, meta);

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

	const remove = document.createElement("button");
	remove.type = "button";
	remove.className = "icon-btn remove";
	remove.title = "Remove from the board";
	remove.setAttribute("aria-label", `Remove ${meeting.title} from the board`);
	remove.innerHTML = ICONS.remove;
	remove.addEventListener("click", () => removeMeeting(meeting, remove));

	item.append(avatar, info, join, copy, remove);
	return item;
}

function render() {
	const meetings = visibleMeetings();

	el.list.replaceChildren(...meetings.map(meetingRow));
	el.count.textContent = String(state.meetings.length);
	el.empty.hidden = meetings.length > 0;

	if (state.meetings.length > 0 && meetings.length === 0) {
		el.empty.querySelector(".empty-title").textContent = "Nothing matches";
		el.empty.querySelector(".empty-note").textContent = "Try another search, or switch back to All.";
	} else {
		el.empty.querySelector(".empty-title").textContent = "The board is clear";
		el.empty.querySelector(".empty-note").textContent = "Be the first to share a meeting — it shows up for everyone within 15 seconds.";
	}
}

/* Data --------------------------------------------------------------------- */

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
		state.etag = res.headers.get("etag");
		state.meetings = Array.isArray(data.meetings) ? data.meetings : [];
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
		if (!res.ok) {
			button.disabled = false;
			setMessage("That meeting could not be removed. Try again in a moment.", "error");
			return;
		}

		state.meetings = state.meetings.filter((m) => m.id !== meeting.id);
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

for (const chip of document.querySelectorAll(".chip")) {
	chip.addEventListener("click", () => {
		state.filter = chip.dataset.filter;
		for (const other of document.querySelectorAll(".chip"))
			other.classList.toggle("is-active", other === chip);
		render();
	});
}

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

	el.submit.disabled = true;
	try {
		const res = await fetch("/api/meetings", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ title: title.title, link: link.link })
		});
		const data = await res.json();

		if (!res.ok) {
			setMessage(data.error || "That meeting could not be posted.", "error");
			return;
		}

		// Show it straight away; the next poll picks up everyone else's posts.
		state.meetings = [data.meeting, ...state.meetings];
		state.etag = null;
		render();

		el.form.reset();
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

// Keep "3 minutes ago" honest between polls.
setInterval(render, 60_000);

el.greeting.textContent = greeting();
el.counter.textContent = `0 of ${MAX_TITLE_WORDS} words`;
poll();
startPolling();
