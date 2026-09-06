import type { IDataObject } from 'n8n-workflow';

/**
 * What GetCourse actually posts to a subscribed URL.
 *
 * None of it is in the OpenAPI specification: the nine Russian-named schemas
 * there describe the *subscription request*, not the delivery. The three shapes
 * below were established from an SDK that ships captured, anonymised bodies —
 * so treat them as observation rather than contract, and never reject a body
 * for failing to match one.
 *
 * The order family has since been captured first-hand, and the SDK's bodies had
 * one thing stripped from them: **the whole payload arrives wrapped in a `json`
 * envelope**, `{"json": { ts, ts64, gcAccountId, user, deal, eventType }}`.
 * Confirmed on the wire rather than guessed — `content-length` matches the
 * wrapped body and exceeds the inner object by the nine bytes the wrapper costs.
 * Everything below therefore runs on the *unwrapped* body; see
 * {@link unwrapDelivery}, which is what makes `$json.deal.status` work instead
 * of `$json.json.deal.status`.
 *
 * Two traps inside that payload, both observed across four consecutive
 * deliveries of the same order:
 *
 *  * **`ts` is not the event time.** It is the order's `createdAt`, identical in
 *    every delivery however far apart the events were. Deduplicating or ordering
 *    on it collapses distinct events into one.
 *  * **`ts` is not UTC either, despite the `Z`.** It is the account's local time
 *    with a `Z` glued on: `10:52:21Z` alongside a `ts64` of 1788681141, which is
 *    `07:52:21Z` — the account's three-hour offset exactly. `ts64` is the honest
 *    one.
 *
 * The families matter because they carry no common discriminator:
 *
 *  1. `eventType` envelope — orders, lesson answers, answer comments, webinar
 *     comments. Carries `ts`, `ts64`, `gcAccountId` and a string `eventType`
 *     such as `getcourse/dealPaid`.
 *  2. flat dialog shape — Входящие *and* HelpDesk, identically. Carries
 *     `event_id`, `dialog_id`, `user_data`, `department`. It says nothing about
 *     which of the two systems it came from, which is why this node subscribes
 *     one event object at a time and labels the delivery from its own settings.
 *  3. call shape — `type: "call"`, with `atc` filled in only when the call came
 *     from the telephony gateway.
 */

/** Event-object ids, as GetCourse numbers them in `set-uri`. */
export const EVENT_OBJECT = {
	incoming: 1,
	orders: 2,
	lessonAnswers: 4,
	answerComments: 5,
	webinarComments: 7,
	calls: 8,
	helpdesk: 9,
} as const;

/**
 * Strips the `json` envelope a set-uri delivery arrives in.
 *
 * The test is deliberately narrow — one key, named `json`, holding an object —
 * because the other source this node serves is a process using «Вызвать URL»,
 * whose every field name was chosen by an administrator. A body that merely
 * *contains* a `json` field is left alone; only a body that is nothing but the
 * envelope is opened. A delivery that is not wrapped, now or later, passes
 * through untouched, so this cannot break the families that arrive flat.
 */
export function unwrapDelivery(body: unknown): unknown {
	if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;

	const keys = Object.keys(body as IDataObject);
	if (keys.length !== 1 || keys[0] !== 'json') return body;

	const inner = (body as IDataObject).json;

	return inner !== null && typeof inner === 'object' && !Array.isArray(inner) ? inner : body;
}

/** Which family a delivered body belongs to, or `undefined` for none of them. */
export function detectFamily(body: IDataObject): 'event' | 'dialog' | 'call' | undefined {
	if (typeof body.eventType === 'string' && body.eventType !== '') return 'event';
	if (body.type === 'call') return 'call';
	if (body.dialog_id !== undefined || body.event_id !== undefined) return 'dialog';

	return undefined;
}

/**
 * A label the workflow can switch on, for the two families that carry none.
 *
 * `eventType` already exists on family 1 and is left exactly as GetCourse sent
 * it. For the other two it is synthesised, and for dialogs it needs the node's
 * own configuration: the body of an Входящие message and the body of a HelpDesk
 * message are indistinguishable, so the only thing that knows which arrived is
 * the subscription this node made.
 */
export function eventTypeFor(body: IDataObject, eventObjectId: number): string | undefined {
	const family = detectFamily(body);

	if (family === 'event') return String(body.eventType);
	if (family === 'call') return 'getcourse/call';

	if (family !== 'dialog') return undefined;

	const eventId = Number(body.event_id);
	const helpdesk = eventObjectId === EVENT_OBJECT.helpdesk;

	const names: Record<number, string> = helpdesk
		? { 1: 'ticketCreated', 2: 'ticketClientMessage', 3: 'ticketStaffMessage' }
		: {
				1: 'dialogCreated',
				2: 'dialogReopened',
				3: 'dialogStudentMessage',
				4: 'dialogStaffMessage',
			};

	const name = names[eventId] ?? (helpdesk ? 'ticketEvent' : 'dialogEvent');

	return `getcourse/${name}`;
}

/**
 * Merges the pieces of a request into one flat object.
 *
 * A process using «Вызвать URL» may send JSON, form fields or a query string,
 * and the admin who configured it chose every field name, so there is nothing to
 * validate against. Query parameters lose to body fields on a name clash, which
 * is the order of specificity: the body is what the operation was configured to
 * send, the query string is usually a constant in the URL.
 */
export function mergeRequest(body: unknown, query: IDataObject): IDataObject {
	const fromBody =
		body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as IDataObject) : {};

	const merged: IDataObject = { ...query, ...fromBody };

	// A body that is not an object at all — a bare string, or an array — would be
	// lost by the spread, so it is kept under a name of its own. An object body,
	// even an empty one, has already been merged: adding `body: {}` on top of it
	// would put a meaningless key in every delivery and, worse, overwrite a query
	// parameter that happens to be called `body`.
	const isPlainObject = body !== null && typeof body === 'object' && !Array.isArray(body);

	if (!isPlainObject && body !== undefined && body !== null && body !== '') {
		merged.body = body as IDataObject[string];
	}

	return merged;
}
