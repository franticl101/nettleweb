import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Store } from "./store.js";
import { validateLink, validateTitle } from "./validate.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
const store = new Store(process.env.DATA_FILE || path.join(root, "data", "meetings.json"));

const MAX_BODY_BYTES = 4096;
const POSTS_PER_MINUTE = 20;

/** @type {Map<string, { count: number, resetAt: number }>} */
const rateLimit = new Map();

const TYPES = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".svg": "image/svg+xml"
};

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function sendJSON(res, status, body) {
	const data = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(data),
		"cache-control": "no-store"
	});
	res.end(data);
}

/** @param {http.IncomingMessage} req */
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;

		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				const err = new Error("Request body too large.");
				err.tooLarge = true;
				reject(err);
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

/** Simple per-IP throttle so an open board cannot be flooded in one go. */
function allowPost(ip) {
	const now = Date.now();
	const entry = rateLimit.get(ip);

	if (entry == null || now > entry.resetAt) {
		rateLimit.set(ip, { count: 1, resetAt: now + 60_000 });
		return true;
	}
	if (entry.count >= POSTS_PER_MINUTE)
		return false;

	entry.count++;
	return true;
}

/**
 * @param {http.ServerResponse} res
 * @param {string} urlPath
 */
function serveStatic(res, urlPath) {
	const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
	const file = path.join(publicDir, rel);

	// Keep the response inside public/, whatever the request path claims.
	if (!file.startsWith(publicDir + path.sep)) {
		sendJSON(res, 403, { error: "Forbidden" });
		return;
	}

	fs.readFile(file, (err, data) => {
		if (err != null) {
			sendJSON(res, 404, { error: "Not found" });
			return;
		}

		res.writeHead(200, {
			"content-type": TYPES[path.extname(file)] || "application/octet-stream",
			"content-length": data.length
		});
		res.end(data);
	});
}

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
	const method = req.method || "GET";

	if (url.pathname === "/api/meetings") {
		if (method === "GET") {
			sendJSON(res, 200, { meetings: store.list() });
			return;
		}

		if (method === "POST") {
			const ip = req.socket.remoteAddress || "unknown";
			if (!allowPost(ip)) {
				sendJSON(res, 429, { error: "Too many posts, try again in a minute." });
				return;
			}

			let payload;
			try {
				payload = JSON.parse(await readBody(req));
			} catch (err) {
				if (err.tooLarge) {
					sendJSON(res, 413, { error: "That request is too large." });
					req.destroy();
				} else
					sendJSON(res, 400, { error: "Expected a JSON body." });
				return;
			}

			const title = validateTitle(payload?.title);
			if (!title.ok) {
				sendJSON(res, 400, { error: title.error });
				return;
			}

			const link = validateLink(payload?.link);
			if (!link.ok) {
				sendJSON(res, 400, { error: link.error });
				return;
			}

			sendJSON(res, 201, {
				meeting: store.add({ title: title.title, link: link.link, provider: link.provider })
			});
			return;
		}

		sendJSON(res, 405, { error: "Method not allowed" });
		return;
	}

	const match = /^\/api\/meetings\/([\w-]+)$/.exec(url.pathname);
	if (match != null) {
		if (method !== "DELETE") {
			sendJSON(res, 405, { error: "Method not allowed" });
			return;
		}

		if (!store.remove(match[1])) {
			sendJSON(res, 404, { error: "No such meeting." });
			return;
		}

		sendJSON(res, 200, { ok: true });
		return;
	}

	if (method !== "GET" && method !== "HEAD") {
		sendJSON(res, 405, { error: "Method not allowed" });
		return;
	}

	serveStatic(res, url.pathname);
});

server.listen(port, host, () => {
	console.log(`Meeting board running on http://${host}:${port}`);
});
