/**
 * A sliding-window request budget, shared across the whole n8n process.
 *
 * GetCourse enforces its Export API limit per account, not per integration:
 * 100 requests per two hours, and a status poll counts as one. Going over
 * answers 903 for *every* caller on that account until the window clears, so
 * throttling is a correctness concern rather than politeness — one impatient
 * workflow can lock the school's other integrations out for two hours.
 *
 * The window is keyed by whatever the caller passes, normally the account host,
 * so parallel executions of different workflows add up to one budget.
 */

import { sleep } from 'n8n-workflow';

/** Reserved moments, ascending, per key. */
const windows = new Map<string, number[]>();

/**
 * Waits until the caller may send one request against `key`, reserving its slot
 * before returning so that concurrent callers queue behind it in order.
 *
 * @param key      Budget identity, normally the account base URL plus a suffix
 *                 naming which budget this is.
 * @param limit    How many requests fit in the window.
 * @param windowMs Length of the window.
 * @param maxWaitMs Refuse rather than queue when the wait would exceed this.
 *                 Returns false in that case; the caller decides what to say.
 */
export async function acquireSlot(
	key: string,
	limit: number,
	windowMs: number,
	maxWaitMs = Number.POSITIVE_INFINITY,
): Promise<boolean> {
	const size = Math.max(1, Math.floor(limit) || 1);

	let slots = windows.get(key);
	if (slots === undefined) {
		slots = [];
		windows.set(key, slots);
	}

	const now = Date.now();
	while (slots.length > 0 && slots[0] <= now - windowMs) slots.shift();

	if (slots.length < size) {
		slots.push(now);
		return true;
	}

	// The window is full. The earliest free moment is one window after the slot
	// `size` places back; reserving it now keeps the queue ordered and fair.
	const readyAt = slots[slots.length - size] + windowMs;
	const wait = Math.max(0, readyAt - now);

	if (wait > maxWaitMs) return false;

	slots.push(readyAt);
	await sleep(wait);
	return true;
}

/** How long the caller would have to wait for a slot, without reserving one. */
export function slotDelay(key: string, limit: number, windowMs: number): number {
	const slots = windows.get(key);
	if (slots === undefined) return 0;

	const size = Math.max(1, Math.floor(limit) || 1);
	const now = Date.now();
	const live = slots.filter((moment) => moment > now - windowMs);

	if (live.length < size) return 0;

	return Math.max(0, live[live.length - size] + windowMs - now);
}

/** Test seam: forget every reservation. */
export function resetRateLimiter(): void {
	windows.clear();
}
