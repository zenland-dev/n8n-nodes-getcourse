/**
 * A short-lived memo for the reads that fill dropdowns.
 *
 * Opening a node with several account-aware pickers fires several requests, and
 * the editor re-runs them whenever a dependent parameter changes. On the legacy
 * Export API that is unaffordable — the account gets 100 requests per two hours
 * in total — and on the Tech API it is merely rude. So dictionary reads are
 * shared for a short while, per credential.
 *
 * The window is deliberately small: someone who has just created a group in
 * GetCourse should see it after a breath, not after restarting n8n.
 */

const TTL_MS = 60_000;

/**
 * The window for a read that costs the account something to make.
 *
 * The legacy field dictionary is the one dropdown source counted against the
 * hundred Export API requests an account gets every two hours, and unlike a
 * group list it describes the account's *configuration* — somebody adding a
 * custom field in the GetCourse admin is a rare event, not a stream. So it is
 * held longer than the rest, which turns a session of opening and closing a node
 * into a single request.
 *
 * Two minutes rather than more, because n8n offers a **Refresh List** action in
 * every dropdown's ⋮ menu and that action cannot reach past this memo: the
 * request it makes is indistinguishable from the one that filled it. A refresh
 * that does nothing for five minutes reads as a broken button, so the window is
 * short enough to be waited out.
 *
 * Two minutes rather than less, because it is not what keeps the account safe —
 * `acquireSlot` does, capping the picker at the credential's Export Requests per
 * Hour whatever this value is, and refusing within ten seconds instead of
 * queueing. This is politeness; the limiter is the guarantee.
 */
export const CONFIG_TTL_MS = 120_000;

const entries = new Map<string, { expiresAt: number; value: Promise<unknown> }>();

function prune(now: number): void {
	for (const [key, entry] of entries) {
		if (entry.expiresAt <= now) entries.delete(key);
	}
}

/**
 * Runs `fetch` unless an identical call is already memoised.
 *
 * A rejection is never remembered: the usual cause is a credential the user is
 * still filling in, and they would otherwise have to wait out the TTL. The
 * rejection still reaches this caller.
 */
export async function cached<T>(key: string, fetch: () => Promise<T>, ttlMs = TTL_MS): Promise<T> {
	const now = Date.now();
	prune(now);

	const hit = entries.get(key);
	if (hit !== undefined) return (await hit.value) as T;

	const value = fetch();
	entries.set(key, { expiresAt: now + ttlMs, value });
	void value.catch(() => entries.delete(key));

	return await value;
}

/** Test seam: forget every memoised read. */
export function resetCache(): void {
	entries.clear();
}
