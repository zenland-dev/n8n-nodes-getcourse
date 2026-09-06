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
export async function cached<T>(key: string, fetch: () => Promise<T>): Promise<T> {
	const now = Date.now();
	prune(now);

	const hit = entries.get(key);
	if (hit !== undefined) return (await hit.value) as T;

	const value = fetch();
	entries.set(key, { expiresAt: now + TTL_MS, value });
	void value.catch(() => entries.delete(key));

	return await value;
}

/** Test seam: forget every memoised read. */
export function resetCache(): void {
	entries.clear();
}
