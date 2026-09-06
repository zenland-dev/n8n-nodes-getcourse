import { timingSafeEqual } from 'node:crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { EVENT_OBJECTS, EVENT_OBJECT_OPTIONS, eventOptions } from '../../utils/events';
import { techApiRequest } from '../GetCourse/v1/transport';
import { eventTypeFor, mergeRequest, unwrapDelivery } from './payload';

/** Addresses GetCourse cannot open from its own servers. */
const UNREACHABLE_HOST = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::|\/|$)/i;

/** The URL n8n hands out for a manual "Listen for test event" run. */
const TEST_WEBHOOK_URL = /\/webhook-test\//;

/**
 * One `events` property per event object.
 *
 * The alternative — one list of all fifteen pairs — would let a workflow
 * subscribe to Входящие and HelpDesk at once, and those two deliver byte-for-byte
 * indistinguishable bodies. Splitting by object keeps every delivery
 * attributable, and costs the user one extra click.
 */
const eventProperties: INodeProperties[] = EVENT_OBJECTS.map((object) => ({
	displayName: 'Events',
	name: `events${object.id}`,
	type: 'multiOptions',
	default: [object.events[0].id],
	required: true,
	options: eventOptions(object.id),
	displayOptions: { show: { source: ['techApi'], eventObject: [object.id] } },
	description: `Какие события ${object.label.toLowerCase()} присылать. Each one is a separate subscription call.`,
}));

export class GetCourseTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'GetCourse Trigger',
		name: 'getCourseTrigger',
		icon: {
			light: 'file:../../icons/getcourse.svg',
			dark: 'file:../../icons/getcourse.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle:
			'={{ $parameter["source"] === "process" ? "process callback" : "set-uri subscription" }}',
		description: 'Starts a workflow when GetCourse reports an event',
		defaults: { name: 'GetCourse Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'getCourseTechApi',
				required: true,
				displayOptions: { show: { source: ['techApi'] } },
			},
		],
		webhooks: [
			{
				name: 'default',
				// The method parameter is hidden for a Tech API subscription, which always
				// posts; the fallback keeps the webhook registered as POST rather than as
				// whatever an unresolved expression evaluates to.
				httpMethod: '={{ $parameter["httpMethod"] || "POST" }}',
				// GetCourse publishes no delivery timeout and no retry policy, so the
				// safe assumption is that it has one and it is short. Answering on
				// receipt keeps the reply independent of how long the workflow runs.
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Source',
				name: 'source',
				type: 'options',
				noDataExpression: true,
				default: 'process',
				options: [
					{
						name: 'GetCourse Process',
						value: 'process',
						description:
							"Процесс с операцией «Вызвать URL». Works on any paid account and needs no developer key, but the account owner has to paste this node's URL into the process by hand.",
					},
					{
						name: 'Tech API Subscription',
						value: 'techApi',
						description:
							'Подписка через set-uri. This node subscribes and unsubscribes itself when the workflow is activated and deactivated, but it needs a Tech API developer key, which GetCourse issues to integrators on request.',
					},
				],
				description:
					'Откуда приходят события. GetCourse has two unrelated webhook systems and they behave differently.',
			},
			{
				displayName:
					'Скопируйте адрес выше в процесс GetCourse: операция «Вызвать URL», метод POST, тело — json или x-www-form-urlencoded. Field names and the field set are entirely yours to choose, so this node passes the body through unchanged rather than expecting a shape. Values come from placeholders such as {object.email} in a user process and {object.user.email} in an order process.',
				name: 'processNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { source: ['process'] } },
			},
			{
				displayName:
					'Подписка живёт у ключа разработчика, а не у воркфлоу: она переживёт удаление этого узла, если не деактивировать его сначала. GetCourse decides by itself what a subscription delivery contains — a body and no headers of yours — so there is nothing to check a shared secret against here, and the address itself is what keeps the events private. Manual testing is not possible either: set-uri holds one address per event, so listening for a test event would replace the live subscription. Activate the workflow instead.',
				name: 'techApiNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { source: ['techApi'] } },
			},
			{
				displayName: 'HTTP Method',
				name: 'httpMethod',
				type: 'options',
				default: 'POST',
				options: [
					{ name: 'POST', value: 'POST' },
					{ name: 'GET', value: 'GET' },
				],
				displayOptions: { show: { source: ['process'] } },
				description:
					'Метод, которым процесс вызывает URL. GetCourse offers both; with GET the data arrives as query parameters instead of a body.',
			},
			{
				displayName: 'Event Object',
				name: 'eventObject',
				type: 'options',
				noDataExpression: true,
				default: 2,
				options: EVENT_OBJECT_OPTIONS,
				displayOptions: { show: { source: ['techApi'] } },
				description:
					'Какие объекты слушаем. One node listens to one object: an Входящие message and a HelpDesk message arrive as identical bodies, so the only thing that can tell them apart is which subscription delivered them.',
			},
			...eventProperties,
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Add Event Type',
						name: 'addEventType',
						type: 'boolean',
						default: true,
						description:
							'Whether to fill in an eventType field when GetCourse sends none (подставить тип события). Order and lesson events carry one already; dialog, HelpDesk and call deliveries do not, and this labels them from the subscription that received them.',
					},
					{
						displayName: 'Include Headers',
						name: 'includeHeaders',
						type: 'boolean',
						default: false,
						description:
							'Whether to add the request headers to every item as "headers" (включить заголовки запроса)',
					},
				],
			},
			/*
			 * Verification lives in its own collection, shown for the process source
			 * alone, and that placement is the point.
			 *
			 * A shared secret works because the person configuring «Вызвать URL» types
			 * the header in themselves. A Tech API subscription is the opposite: the
			 * node hands GetCourse a URL and GetCourse decides what to send, which is
			 * a body and nothing else. Offering the field there would let somebody
			 * arm a check that no genuine delivery can ever pass — every real event
			 * refused, silently, with the workflow looking healthy.
			 */
			{
				displayName: 'Verification',
				name: 'verification',
				type: 'collection',
				placeholder: 'Add Setting',
				default: {},
				displayOptions: { show: { source: ['process'] } },
				description:
					'Проверка отправителя. GetCourse signs nothing, so a shared secret set in the process is the only way to tell its calls from anyone else who learns this URL.',
				options: [
					{
						displayName: 'Expected Secret',
						name: 'secretValue',
						type: 'string',
						typeOptions: { password: true },
						default: '',
						description:
							'Значение, которое должно прийти в заголовке или параметре, названном ниже. A request without it is answered 403 and starts nothing. Add the same header in the «Вызвать URL» settings of the process.',
					},
					{
						displayName: 'Secret Location',
						name: 'verifyIn',
						type: 'options',
						default: 'header',
						options: [
							{ name: 'Header', value: 'header' },
							{ name: 'Query Parameter', value: 'query' },
						],
						description: 'Где искать секрет — in a request header or in the URL query string',
					},
					{
						displayName: 'Secret Name',
						name: 'verifyName',
						type: 'string',
						default: 'x-getcourse-secret',
						description:
							'Имя заголовка или параметра, carrying the secret. Header names are matched case-insensitively.',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			/**
			 * The Tech API publishes no way to list existing subscriptions, so this can
			 * only ever answer "no" and let `create` run. Subscribing again to the same
			 * URL and event is the platform's own idempotent path — `set-uri` sets a
			 * value rather than appending one.
			 */
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return String(this.getNodeParameter('source', 'process')) !== 'techApi';
			},

			async create(this: IHookFunctions): Promise<boolean> {
				if (String(this.getNodeParameter('source', 'process')) !== 'techApi') return true;

				const uri = webhookDestination.call(this);

				// `set-uri` holds one address per event, so subscribing the throwaway
				// test URL would replace the production subscription — and unsubscribing
				// it when the test ends would leave the live workflow receiving nothing.
				// A test that silently breaks the thing it is testing is worth refusing.
				if (TEST_WEBHOOK_URL.test(uri)) {
					throw new NodeOperationError(
						this.getNode(),
						'A Tech API subscription cannot be tested with "Listen for test event"',
						{
							description:
								'GetCourse keeps one address per event, so subscribing this temporary URL would replace the live one and testing would take the running workflow off the air. Activate the workflow to receive real events, or switch Source to GetCourse Process and paste the test URL into the process by hand.',
						},
					);
				}
				const { objectId, eventIds } = selectedEvents.call(this);

				if (eventIds.length === 0) {
					throw new NodeOperationError(this.getNode(), 'No GetCourse events are selected', {
						description: 'Pick at least one entry under "Events".',
					});
				}

				// One call per event: the endpoint takes a single
				// event_object_id / event_id pair and has no batch form. That makes
				// activation non-atomic, so a failure half-way through is rolled back —
				// otherwise a workflow that failed to activate would still be leaving
				// GetCourse posting into a URL n8n is not listening on.
				const subscribed: number[] = [];

				try {
					for (const eventId of eventIds) {
						await setSubscription.call(this, uri, objectId, eventId, 1);
						subscribed.push(eventId);
					}
				} catch (error) {
					for (const eventId of subscribed) {
						// Best effort: the original failure is what the user needs to see,
						// and a rollback that fails too must not replace it.
						try {
							await setSubscription.call(this, uri, objectId, eventId, 0);
						} catch {
							this.logger?.warn(
								`GetCourse Trigger could not roll back its subscription to event ${objectId}:${eventId} on ${uri}`,
							);
						}
					}

					// The transport already turned this into a NodeApiError carrying a message
					// the user can act on; wrapping it again would bury that message.
					/* eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- already a NodeApiError from the transport */
					throw error;
				}

				const staticData = this.getWorkflowStaticData('node');
				staticData.uri = uri;
				staticData.objectId = objectId;
				staticData.eventIds = eventIds;

				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				if (String(this.getNodeParameter('source', 'process')) !== 'techApi') return true;

				const staticData = this.getWorkflowStaticData('node');

				// Read from static data first: the events may have been edited since the
				// subscription was made, and unsubscribing from the current selection
				// would leave the old one delivering into a dead URL.
				const uri = String(staticData.uri ?? '') || webhookDestination.call(this);
				const objectId = Number(staticData.objectId ?? selectedEvents.call(this).objectId);
				const eventIds = Array.isArray(staticData.eventIds)
					? (staticData.eventIds as number[])
					: selectedEvents.call(this).eventIds;

				// Every event is attempted even after one of them fails: stopping at the
				// first would leave the rest subscribed to a URL that is about to stop
				// answering, and GetCourse offers no way to list what is subscribed and
				// clean up later. The first failure is re-thrown once they have all been
				// tried, so deactivation still reports the problem.
				let failure: unknown;
				const stillSubscribed: number[] = [];

				for (const eventId of eventIds) {
					try {
						await setSubscription.call(this, uri, objectId, eventId, 0);
					} catch (error) {
						failure = failure ?? error;
						stillSubscribed.push(eventId);
					}
				}

				// The record is cleared only for what actually came off. Clearing it up
				// front would be tidier but loses the one thing needed to finish the job:
				// nothing in the API lists subscriptions, so an address this node forgets
				// keeps receiving events with no way left to find it.
				if (stillSubscribed.length === 0) {
					delete staticData.uri;
					delete staticData.objectId;
					delete staticData.eventIds;
				} else {
					staticData.uri = uri;
					staticData.objectId = objectId;
					staticData.eventIds = stillSubscribed;
				}

				// Same reasoning as in create: the transport has already shaped this error.
				if (failure !== undefined) throw failure;

				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const verification = this.getNodeParameter('verification', {}) as IDataObject;
		const request = this.getRequestObject();
		const headers = this.getHeaderData() as IDataObject;
		const query = this.getQueryData() as IDataObject;

		if (!secretAccepted(verification, headers, query)) {
			// Written straight onto the response rather than returned as
			// `webhookResponse`, which n8n always sends with a 200: a caller that
			// failed the check has to be told 403, or a misconfigured GetCourse process
			// looks to its owner like it is delivering successfully.
			//
			// Answered rather than thrown, so a stray request does not fill the
			// execution list with failures, and the body says nothing about why.
			this.getResponseObject().status(403).json({ status: 'forbidden' });

			return { noWebhookResponse: true };
		}

		// Unwrapped before anything reads it: a set-uri delivery arrives as
		// `{"json": {…}}`, so without this every field sits one level deeper than
		// the workflow expects and the eventType detection below — which looks at
		// the top level — finds nothing at all.
		const payload = withoutSecret(
			verification,
			mergeRequest(unwrapDelivery(request.body), query),
			'query',
		);

		if (options.addEventType !== false) {
			const objectId = Number(this.getNodeParameter('eventObject', 0));
			const eventType = eventTypeFor(payload, objectId);

			if (eventType !== undefined && payload.eventType === undefined) {
				payload.eventType = eventType;
			}
		}

		// Include Headers is exactly what somebody turns on while working out why the
		// check answers 403, which is the worst possible moment to print the secret.
		if (options.includeHeaders === true) {
			payload.headers = withoutSecret(verification, headers, 'header');
		}

		const item: INodeExecutionData = { json: payload };

		return { workflowData: [[item]] };
	}
}

/** One subscribe or unsubscribe call. `subscribe` is 1 to add, 0 to remove. */
async function setSubscription(
	this: IHookFunctions,
	uri: string,
	objectId: number,
	eventId: number,
	subscribe: 0 | 1,
): Promise<void> {
	await techApiRequest.call(this, 'POST', '/set-uri', {
		uri,
		event_object_id: objectId,
		event_id: eventId,
		subscribe,
	});
}

/** The URL GetCourse is told to post to, checked for reachability. */
function webhookDestination(this: IHookFunctions): string {
	const url = this.getNodeWebhookUrl('default');

	if (url === undefined || url === '') {
		throw new NodeOperationError(this.getNode(), 'This node has no webhook URL yet', {
			description: 'Save the workflow, then activate it so n8n can hand GetCourse an address.',
		});
	}

	if (UNREACHABLE_HOST.test(url)) {
		throw new NodeOperationError(this.getNode(), `GetCourse cannot reach ${url}`, {
			description:
				'Webhooks are delivered from GetCourse servers, so this n8n instance needs an address reachable from the internet. Set WEBHOOK_URL to the public address, or put a tunnel in front of n8n.',
		});
	}

	return url;
}

/** The object and the event ids the node is currently configured for. */
function selectedEvents(this: IHookFunctions): { objectId: number; eventIds: number[] } {
	const objectId = Number(this.getNodeParameter('eventObject', 2));
	const selected = this.getNodeParameter(`events${objectId}`, []) as Array<number | string>;

	const eventIds = [...new Set(selected.map((id) => Number(id)))].filter((id) =>
		Number.isFinite(id),
	);

	return { objectId, eventIds };
}

/**
 * Compares the configured secret with what arrived, without leaking its length
 * through the comparison time.
 *
 * `timingSafeEqual` throws on a length mismatch, so the lengths are compared
 * first — which does leak the length, and is the accepted trade: an attacker who
 * can measure that still has to guess the value.
 */
/**
 * Removes the shared secret from whatever is about to be handed to the workflow.
 *
 * By the time this runs the secret has done its only job: it proved the caller.
 * Leaving it in would undo the `password: true` on the field — n8n masks it
 * everywhere in the editor, and then the execution record would store it in
 * clear text, the output panel would print it, and every downstream node would
 * receive it, an HTTP node that forwards the item included. Executions are
 * readable by a far wider group than credentials are, and anyone who read one
 * could forge deliveries into this workflow for as long as the secret stood.
 *
 * Names are lower-cased on both sides, matching how `secretAccepted` finds them.
 * A body field that happens to share the secret's name is dropped too: losing a
 * field in that contrived case is the better error of the two.
 */
function withoutSecret(
	verification: IDataObject,
	carrier: IDataObject,
	location: 'header' | 'query',
): IDataObject {
	if (String(verification.secretValue ?? '') === '') return carrier;
	if ((verification.verifyIn === 'query' ? 'query' : 'header') !== location) return carrier;

	const name = String(verification.verifyName ?? 'x-getcourse-secret').toLowerCase();
	const cleaned: IDataObject = {};

	for (const [key, value] of Object.entries(carrier)) {
		if (key.toLowerCase() !== name) cleaned[key] = value;
	}

	return cleaned;
}

function secretAccepted(
	verification: IDataObject,
	headers: IDataObject,
	query: IDataObject,
): boolean {
	const expected = String(verification.secretValue ?? '');
	if (expected === '') return true;

	const name = String(verification.verifyName ?? 'x-getcourse-secret').toLowerCase();
	const source =
		verification.verifyIn === 'query'
			? Object.entries(query).find(([key]) => key.toLowerCase() === name)?.[1]
			: headers[name];

	// A header sent twice arrives as an array; joining it can only ever produce
	// something that fails the comparison, which is the right outcome.
	const provided = Array.isArray(source) ? source.join(',') : String(source ?? '');

	// Byte lengths, not character lengths. `timingSafeEqual` throws when the two
	// buffers differ in size, and a Cyrillic secret is two bytes per character —
	// so comparing lengths in characters would let a wrong guess of equal
	// character length reach the call and turn a quiet rejection into a 500.
	const left = Buffer.from(provided, 'utf8');
	const right = Buffer.from(expected, 'utf8');
	if (left.length !== right.length) return false;

	return timingSafeEqual(left, right);
}
