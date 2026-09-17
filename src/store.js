// Flat-file store. Meetings live in one JSON file, written atomically and
// kept in memory so reads never touch the disk.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MAX_MEETINGS = 200;

export class Store {
	/** @param {string} file */
	constructor(file) {
		this.file = file;
		/** @type {{ id: string, title: string, link: string, provider: string, createdAt: string }[]} */
		this.meetings = [];
		this.#load();
	}

	#load() {
		try {
			const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
			if (Array.isArray(parsed))
				this.meetings = parsed;
		} catch (err) {
			if (err.code !== "ENOENT")
				console.error(`Could not read ${this.file}, starting empty:`, err.message);
		}
	}

	#save() {
		const temp = `${this.file}.tmp`;
		fs.mkdirSync(path.dirname(this.file), { recursive: true });
		fs.writeFileSync(temp, JSON.stringify(this.meetings, null, "\t"));
		fs.renameSync(temp, this.file);
	}

	list() {
		return this.meetings;
	}

	/**
	 * Newest first. The oldest entries fall off once the board is full.
	 * @param {{ title: string, link: string, provider: string }} entry
	 */
	add({ title, link, provider }) {
		const meeting = {
			id: randomUUID(),
			title,
			link,
			provider,
			createdAt: new Date().toISOString()
		};

		this.meetings.unshift(meeting);
		if (this.meetings.length > MAX_MEETINGS)
			this.meetings.length = MAX_MEETINGS;

		this.#save();
		return meeting;
	}

	/** @param {string} id */
	remove(id) {
		const index = this.meetings.findIndex((m) => m.id === id);
		if (index < 0)
			return false;

		this.meetings.splice(index, 1);
		this.#save();
		return true;
	}
}
