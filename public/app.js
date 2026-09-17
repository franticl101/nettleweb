const form = document.getElementById("form");
const titleInput = document.getElementById("title");
const linkInput = document.getElementById("link");
const counter = document.getElementById("counter");
const errorBox = document.getElementById("error");
const list = document.getElementById("list");
const empty = document.getElementById("empty");
const submit = form.querySelector("button");

const MAX_WORDS = 10;

function countWords(value) {
	const trimmed = value.trim();
	return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function showError(message) {
	errorBox.textContent = message || "";
	errorBox.hidden = !message;
}

function relativeTime(iso) {
	const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
	return `${Math.round(minutes / 1440)}d ago`;
}

function render(meetings) {
	list.textContent = "";
	empty.hidden = meetings.length > 0;

	for (const meeting of meetings) {
		const item = document.createElement("li");

		const info = document.createElement("div");
		info.className = "info";

		const title = document.createElement("span");
		title.className = "title";
		title.textContent = meeting.title;

		const meta = document.createElement("div");
		meta.className = "meta";
		const provider = document.createElement("span");
		provider.textContent = meeting.provider === "zoom" ? "Zoom" : "Google Meet";
		const posted = document.createElement("span");
		posted.textContent = relativeTime(meeting.createdAt);
		meta.append(provider, "·", posted);

		info.append(title, meta);

		const join = document.createElement("a");
		join.className = "join";
		join.href = meeting.link;
		join.target = "_blank";
		join.rel = "noopener noreferrer";
		join.textContent = "Join";

		const remove = document.createElement("button");
		remove.className = "remove";
		remove.type = "button";
		remove.title = "Remove";
		remove.setAttribute("aria-label", `Remove ${meeting.title}`);
		remove.textContent = "×";
		remove.addEventListener("click", async () => {
			remove.disabled = true;
			const res = await fetch(`/api/meetings/${meeting.id}`, { method: "DELETE" });
			if (res.ok) load();
			else remove.disabled = false;
		});

		item.append(info, join, remove);
		list.append(item);
	}
}

async function load() {
	try {
		const res = await fetch("/api/meetings");
		const data = await res.json();
		render(data.meetings || []);
	} catch {
		showError("Could not load meetings.");
	}
}

titleInput.addEventListener("input", () => {
	const words = countWords(titleInput.value);
	counter.textContent = `${words}/${MAX_WORDS} words`;
	counter.classList.toggle("over", words > MAX_WORDS);
});

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	showError("");

	if (countWords(titleInput.value) > MAX_WORDS) {
		showError(`Title must be ${MAX_WORDS} words or fewer.`);
		return;
	}

	submit.disabled = true;
	try {
		const res = await fetch("/api/meetings", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ title: titleInput.value, link: linkInput.value })
		});
		const data = await res.json();

		if (!res.ok) {
			showError(data.error || "Could not post that meeting.");
			return;
		}

		form.reset();
		counter.textContent = `0/${MAX_WORDS} words`;
		counter.classList.remove("over");
		await load();
	} catch {
		showError("Could not reach the server.");
	} finally {
		submit.disabled = false;
	}
});

load();
setInterval(load, 30_000);
