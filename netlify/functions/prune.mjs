// Expired meetings are never served, but they should not linger in storage
// either. This sweeps them out on a schedule, and drops the edge copy so the
// board catches up on the next poll.

import { refreshEdge, updateBoard } from "../board.mjs";

export const config = {
	schedule: "*/15 * * * *"
};

export default async function prune() {
	const result = await updateBoard((live, all) => (live.length === all.length ? null : live));

	if (!result.ok) {
		console.log("Nothing to prune.");
		return;
	}

	console.log(`Pruned expired meetings; ${result.meetings.length} left on the board.`);
	await refreshEdge();
}
