import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IPollFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { NodeOperationError, randomInt, sleep } from 'n8n-workflow';

import { accountBaseUrl } from '../../../../credentials/accountAddress';
import { cached } from '../../../../utils/cache';
import { extractRetryAfterMs, extractStatusCode } from '../../../../utils/httpError';
import { acquireSlot } from '../../../../utils/rateLimiter';
import type { TechApiEnvelope } from '../helpers/errors';
import { envelopeError, toTechApiError } from '../helpers/errors';

/** Every context this node makes API calls from. */
export type GetCourseContext =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IHookFunctions
	| IWebhookFunctions
	| IPollFunctions;

export const CREDENTIAL_NAME = 'getCourseTechApi';

/** Everything under the Tech API lives below this prefix. */
const API_PREFIX = '/pl/api/v1';

/** Server errors worth a second try, but only for reads. */
const RETRYABLE_READ_STATUSES = new Set([500, 502, 503, 504]);

export interface TechRequestOptions {
	/** Return the whole `{ status, message, code, errors, data }` envelope. */
	fullResponse?: boolean;
	/** Total attempts, including the first one. */
	maxAttempts?: number;
	/** Extra headers, merged last. */
	headers?: IDataObject;
}

interface AccountConnection {
	baseUrl: string;
	requestsPerSecond: number;
	credentialId: string;
}

async function resolveAccount(this: GetCourseContext): Promise<AccountConnection> {
	const credentials = await this.getCredentials(CREDENTIAL_NAME);

	// Rebuilt from the address fields rather than taken as typed: the dropdown is
	// only an editor hint, and stored values reach us through the expression
	// engine. An unusable address yields '' and fails here instead of sending the
	// token somewhere unintended.
	const baseUrl = accountBaseUrl(credentials);

	if (baseUrl === '') {
		throw new NodeOperationError(
			this.getNode(),
			'The GetCourse credential has no usable account address',
			{
				description:
					'Open the credential and fill in the account address — either the subdomain, for example myschool.getcourse.ru, or the school domain.',
			},
		);
	}

	return {
		baseUrl,
		requestsPerSecond: Number(credentials.requestsPerSecond) || 5,
		credentialId: this.getNode().credentials?.[CREDENTIAL_NAME]?.id ?? 'unbound',
	};
}

/** Waits 1s, 2s, 4s… with jitter, or honours `Retry-After` when one is sent. */
function backoffDelay(attempt: number, error: unknown): number {
	const advertised = extractRetryAfterMs(error);
	if (advertised !== undefined) return Math.min(advertised, 60_000);

	return Math.min(2 ** (attempt - 1) * 1000, 16_000) + randomInt(250);
}

/**
 * One request against the GetCourse Tech API, rate-limited and retried.
 *
 * The return type is deliberately loose: an endpoint may answer with one object,
 * an array, or nothing at all, and every caller narrows it on the spot.
 *
 * 429 is retried for every method — the request is rejected before it touches
 * any data, so replaying a write is safe. Server errors are retried for reads
 * only, because a 504 on a write may well have been applied.
 */
export async function techApiRequest(
	this: GetCourseContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
	qs?: IDataObject,
	options: TechRequestOptions = {},
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous by design
): Promise<any> {
	const account = await resolveAccount.call(this);

	const url = `${account.baseUrl}${API_PREFIX}${endpoint}`;

	const requestOptions: IHttpRequestOptions = {
		method,
		baseURL: `${account.baseUrl}${API_PREFIX}`,
		url: endpoint,
		json: true,
		returnFullResponse: true,
		// A GetCourse account can force a redirect from its platform address to a
		// domain of its own, and then serves the API only on that domain. Following
		// the redirect would hand the bearer token to the other host and, on a POST,
		// arrive there without a body. Refusing and naming the target turns a whole
		// class of confusing failures into one sentence.
		disableFollowRedirect: true,
		// Statuses are read below rather than thrown, so that a 403's own envelope
		// can be reported instead of the transport's guess at what 403 means.
		ignoreHttpStatusErrors: true,
	};

	if (options.headers !== undefined) requestOptions.headers = options.headers;
	if (body !== undefined) requestOptions.body = body;

	const query = compactQuery(qs);
	if (Object.keys(query).length > 0) requestOptions.qs = query;

	const maxAttempts = options.maxAttempts ?? 4;

	for (let attempt = 1; ; attempt++) {
		await acquireSlot(`${account.baseUrl}|tech`, account.requestsPerSecond, 1000);

		let response: IDataObject;

		try {
			response = (await this.helpers.httpRequestWithAuthentication.call(
				this,
				CREDENTIAL_NAME,
				requestOptions,
			)) as IDataObject;
		} catch (error) {
			// Status errors are switched off above, so anything here is a transport
			// failure: DNS, TLS, a reset connection.
			if (attempt < maxAttempts) {
				await sleep(backoffDelay(attempt, error));
				continue;
			}

			throw toTechApiError(this.getNode(), error, extractStatusCode(error));
		}

		const status = Number(response.statusCode);

		assertNoRedirect.call(this, response, url);

		const envelope = readEnvelope.call(this, response.body, url, status);

		if (status === 429 || (method === 'GET' && RETRYABLE_READ_STATUSES.has(status))) {
			if (attempt < maxAttempts) {
				await sleep(backoffDelay(attempt, { response }));
				continue;
			}
		}

		// Two independent verdicts, and either can be the failure: the envelope's own
		// flag, and the HTTP status. Several endpoints answer 200 with the flag off.
		if (envelope.status === false || status >= 400) {
			throw toTechApiError(this.getNode(), envelopeError(this.getNode(), envelope), status);
		}

		return options.fullResponse === true ? envelope : envelope.data;
	}
}

/**
 * Refuses to follow a redirect, and says where it pointed.
 *
 * The symptom without this is a 403 blamed on the developer key, because the
 * redirect target answers the bearer token with its own login page.
 */
function assertNoRedirect(this: GetCourseContext, response: IDataObject, url: string): void {
	const status = Number(response.statusCode);
	if (!Number.isFinite(status) || status < 300 || status >= 400) return;

	const headers = (response.headers ?? {}) as IDataObject;
	const location = String(headers.location ?? headers.Location ?? '').trim();
	const host = location === '' ? '' : location.replace(/^https?:\/\//i, '').split('/')[0];

	throw new NodeOperationError(
		this.getNode(),
		'The GetCourse account redirects API calls elsewhere',
		{
			description:
				`${url} answered ${status}${host === '' ? '' : ` and pointed at ${host}`}. An account that ` +
				'force-redirects its GetCourse address to its own domain serves the API only on that domain. ' +
				`Set the credential to Custom Domain${host === '' ? '' : ` and enter ${host}`}. The redirect ` +
				'was not followed: it would have sent the developer key to the other host.',
		},
	);
}

/**
 * Insists that the answer really is the Tech API's envelope.
 *
 * `{ status, message, code, errors, data }` is what almost every response looks
 * like, and rejecting anything without a `status` is what stops a login page
 * from becoming an empty result: such a body has no `status`, so nothing is
 * false, and `data` is simply undefined.
 *
 * `POST /set-uri` is the exception, and it is not a small one — it is the call
 * the trigger node makes to subscribe and unsubscribe. It answers
 * `{"success":"OK"}` and nothing else: no `status`, no `data`, no `code`. Held
 * to the rule above it throws, so activating a GetCourse Trigger failed with a
 * message blaming a custom domain or a proxy, and deactivating it failed the
 * same way — leaving a subscription that could not be removed through the node.
 * Its failures come back differently again: a missing `uri` answers HTTP 400
 * with `{"name":"Bad Request","message":"","code":0,"status":400}`, where
 * `status` is the HTTP code as a *number* rather than the usual boolean, which
 * the caller's `status === false` check correctly declines to read as success
 * and the HTTP status catches instead.
 */
export function readEnvelope(
	this: GetCourseContext,
	body: unknown,
	url: string,
	status: number,
): TechApiEnvelope {
	const isObject = body !== null && typeof body === 'object' && !Array.isArray(body);

	if (isObject && 'status' in body) return body as TechApiEnvelope;

	// `success` is `"OK"` on every accepted call. Nothing else has been seen in
	// that field, so anything else is treated as a refusal rather than guessed at.
	if (isObject && 'success' in body) {
		const flag = (body as IDataObject).success;
		const ok = flag === true || flag === 1 || String(flag).trim().toUpperCase() === 'OK';

		return { status: ok, message: ok ? '' : String(flag), code: status, errors: [], data: [] };
	}

	const text = String(body ?? '').trim();

	throw new NodeOperationError(
		this.getNode(),
		'GetCourse answered with something other than API data',
		{
			description:
				`${url} answered ${status} with ${text === '' ? 'an empty body' : 'a body carrying neither a status nor a success field'}. ` +
				'Tech API responses carry one or the other, so this is not the API answering — the usual cause is an ' +
				'account that serves it on its own domain, or a proxy in front of n8n.',
		},
	);
}

/**
 * A GET whose result is shared between dropdowns for a minute.
 *
 * Keyed on the credential rather than the account: two credentials pointed at
 * one school can carry different developer keys and so may see different data.
 */
export async function techApiCachedRequest(
	this: GetCourseContext,
	endpoint: string,
	qs: IDataObject = {},
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see techApiRequest
): Promise<any> {
	const credentialId = this.getNode().credentials?.[CREDENTIAL_NAME]?.id ?? 'unbound';
	const key = `tech|${credentialId}|${endpoint}|${JSON.stringify(qs)}`;

	return await cached(
		key,
		async () => await techApiRequest.call(this, 'GET', endpoint, undefined, qs),
	);
}

/**
 * Walks an endpoint that pages with `limit` and `offset`.
 *
 * The Tech API reports no total and no "next" marker, so the only end signal is
 * a page shorter than asked for — which also means a page that happens to be
 * exactly `pageSize` long costs one extra request to discover the end.
 */
export async function techApiRequestAllItems(
	this: GetCourseContext,
	endpoint: string,
	qs: IDataObject = {},
	options: { limit?: number; pageSize?: number; maxPages?: number } = {},
): Promise<IDataObject[]> {
	const pageSize = Math.max(1, options.pageSize ?? 100);
	const maxPages = options.maxPages ?? 500;
	const rows: IDataObject[] = [];

	for (let page = 0; ; page++) {
		// The cap exists so a paging bug cannot run forever, not to trim a result.
		// Reaching it means the answer is incomplete, and returning it as though it
		// were the whole list is the one outcome worth refusing: a workflow that
		// reconciles against a truncated list deletes what it could not see.
		if (page >= maxPages) {
			throw new NodeOperationError(this.getNode(), `More than ${rows.length} rows to read`, {
				description:
					`${endpoint} is still returning rows after ${maxPages} pages. Narrow the request, or ` +
					'turn Return All off and take a defined number — this node will not hand back a ' +
					'silently shortened list.',
			});
		}

		const wanted =
			options.limit === undefined ? pageSize : Math.min(pageSize, options.limit - rows.length);
		if (wanted <= 0) break;

		const batch = (await techApiRequest.call(this, 'GET', endpoint, undefined, {
			...qs,
			limit: wanted,
			offset: page * pageSize,
		})) as IDataObject[] | undefined;

		if (!Array.isArray(batch) || batch.length === 0) break;
		rows.push(...batch);

		if (batch.length < wanted) break;
	}

	return options.limit === undefined ? rows : rows.slice(0, options.limit);
}

/** Drops query keys the user left blank; an empty filter is not a filter. */
export function compactQuery(input?: IDataObject): IDataObject {
	const output: IDataObject = {};

	for (const [key, value] of Object.entries(input ?? {})) {
		if (value === undefined || value === null || value === '') continue;
		if (Array.isArray(value) && value.length === 0) continue;
		output[key] = value;
	}

	return output;
}
