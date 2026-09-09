import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeOperationError, randomInt, sleep } from 'n8n-workflow';

import { accountBaseUrl } from '../../../../credentials/accountAddress';
import { cached } from '../../../../utils/cache';
import { extractStatusCode } from '../../../../utils/httpError';
import { flattenQuery } from '../../../../utils/query';
import { acquireSlot, slotDelay } from '../../../../utils/rateLimiter';
import type { LegacyEnvelope } from '../helpers/errors';
import { envelopeError, isExportPending, isTruthyFlag, toLegacyApiError } from '../helpers/errors';

/** Every context this node makes API calls from. */
export type LegacyContext = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

export const CREDENTIAL_NAME = 'getCourseTechApi';

/** The window this node counts export requests in. */
const EXPORT_WINDOW_MS = 3_600_000;

/**
 * How long a caller may sit waiting for a free export slot.
 *
 * Beyond this the honest answer is an error naming the budget, not a workflow
 * that appears to hang for the rest of the hour.
 */
const MAX_BUDGET_WAIT_MS = 15 * 60_000;

/**
 * The same ceiling for a read that fills a dropdown.
 *
 * The editor asks for these while somebody is looking at it. Fifteen minutes of
 * queueing would read as a hung interface, and the honest answer — that the
 * account's export budget is spent — is far more useful than a spinner.
 */
const MAX_DROPDOWN_WAIT_MS = 10_000;

interface AccountConnection {
	baseUrl: string;
	/** The account key. The credential calls it the school key; this API calls it `key`. */
	schoolKey: string;
	exportRequestsPerHour: number;
	credentialId: string;
}

async function resolveAccount(this: LegacyContext): Promise<AccountConnection> {
	const credentials = await this.getCredentials(CREDENTIAL_NAME);
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
		schoolKey: String(credentials.schoolApiKey ?? ''),
		exportRequestsPerHour: Number(credentials.exportRequestsPerHour) || 45,
		credentialId: this.getNode().credentials?.[CREDENTIAL_NAME]?.id ?? 'unbound',
	};
}

/**
 * Redirects are refused rather than followed, for two separate reasons.
 *
 * An import is a POST, and every mainstream HTTP client turns a 301 or 302 into
 * a bodyless GET — GetCourse then answers «Пустой параметр action», an error
 * that names the wrong thing entirely and has kept people busy for hours. An
 * export carries the account's secret key in the query string, so following a
 * redirect to another host would hand that key over.
 *
 * The cause is almost always the same: the account force-redirects its GetCourse
 * address to a domain of its own, and its help page says the API must then be
 * called on that domain. Naming the target here turns the whole class of failure
 * into one readable sentence.
 */
function assertNoRedirect(this: LegacyContext, response: IDataObject, url: string): void {
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
				'was not followed: it would have stripped the request body and sent the account key to the other host.',
		},
	);
}

/**
 * What came back when the answer is not a JSON object.
 *
 * A subdomain GetCourse does not know answers 404 with the plain text
 * "Wrong subdomain"; a path it does not serve answers 404 with a whole HTML
 * page; and an import the account is not entitled to make answers **200 with an
 * empty body and a `text/html` content type** — no redirect, no error, nothing.
 * All three arrive here as a string, and each has a different cause, so each
 * gets its own sentence. Blaming a custom domain for all of them, as this used
 * to, sends people to change a credential setting that was never wrong.
 */
function assertEnvelope(
	this: LegacyContext,
	body: unknown,
	url: string,
	status: number,
): LegacyEnvelope {
	if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
		return body as LegacyEnvelope;
	}

	const text = String(body ?? '').trim();

	if (text.toLowerCase().includes('wrong subdomain')) {
		throw new NodeOperationError(this.getNode(), 'GetCourse does not know that account', {
			description:
				'The address in the credential does not resolve to a GetCourse account. Check the subdomain — it is the part in front of .getcourse.ru.',
		});
	}

	// Observed on a live account: every `action=add` and `action=update` against
	// /pl/api/users came back like this and created nothing, while /pl/api/deals
	// on the same account and the same key answered a normal envelope. The key
	// was confirmed by its owner to hold write permission, and an unknown action
	// on the same endpoint still answered «Действие запрещено» as JSON, so the
	// request is understood and then dropped rather than refused. What the
	// account had in common with that is its plan: the same key drove Tech API
	// writes on the same school without complaint, so it is the legacy Import
	// API specifically that the plan withholds — silently, and without the 917
	// the help page promises for a disabled API.
	if (text === '') {
		throw new NodeOperationError(this.getNode(), 'GetCourse answered nothing at all', {
			description: `${url} returned ${status} with an empty body, so there is no way to tell whether anything was written — and on the imports observed this way, nothing was. This is how GetCourse refuses an import the plan does not include: it does not answer error_code 917, it answers nothing. Check the account's plan first, then that the key is allowed to write under Профиль → Настройки аккаунта → АПИ, and confirm in the account itself whether the object appeared before running the workflow again.`,
		});
	}

	throw new NodeOperationError(
		this.getNode(),
		'GetCourse answered with a page instead of API data',
		{
			description:
				`The request to ${url} came back as ${status === 404 ? `${status} and a web page` : 'text rather than JSON'}. ` +
				(status === 404
					? 'That path is not one this account serves. If the account force-redirects its GetCourse address to a domain of its own, the API answers only on that domain — switch the credential to Custom Domain.'
					: 'The usual cause is an account that serves the API on its own domain; switch the credential to Custom Domain.'),
		},
	);
}

/** Throws unless the envelope says the call itself succeeded. */
function assertSuccess(this: LegacyContext, envelope: LegacyEnvelope): LegacyEnvelope {
	if (isTruthyFlag(envelope.success)) return envelope;

	// Absent rather than false: nothing observed answers this way, but a future
	// endpoint that returns a bare payload should not be read as a failure.
	if (envelope.success === undefined && envelope.error === undefined) return envelope;

	throw envelopeError(this.getNode(), envelope);
}

/**
 * Sends one request and normalises whatever comes back.
 *
 * Retries are deliberately thin. The import endpoints are not idempotent — a
 * replayed order import can create a second order — and every export retry costs
 * one of the hundred requests the account gets per two hours. So only a read
 * that failed with a server error is tried again, and only twice.
 */
async function send(
	this: LegacyContext,
	requestOptions: IHttpRequestOptions,
	retryable: boolean,
	beforeAttempt?: () => Promise<void>,
): Promise<LegacyEnvelope> {
	const maxAttempts = retryable ? 3 : 1;
	const url = `${requestOptions.baseURL ?? ''}${requestOptions.url}`;

	for (let attempt = 1; ; attempt++) {
		// Runs before every attempt, retries included. GetCourse counts requests, not
		// intentions: a retry is another one of the hundred the account gets every
		// two hours, and charging the budget once for three calls would let a run of
		// server errors quietly overspend it.
		if (beforeAttempt !== undefined) await beforeAttempt();

		let response: IDataObject;

		try {
			response = (await this.helpers.httpRequest(requestOptions)) as IDataObject;
		} catch (error) {
			// HTTP status errors are switched off below, so anything landing here is a
			// transport failure: DNS, TLS, a reset connection.
			const status = extractStatusCode(error);

			if (retryable && attempt < maxAttempts) {
				await sleep(Math.min(2 ** (attempt - 1) * 1000, 8000) + randomInt(250));
				continue;
			}

			throw toLegacyApiError(this.getNode(), error, status);
		}

		assertNoRedirect.call(this, response, url);

		const status = Number(response.statusCode);
		const body = response.body;
		const isEnvelope = body !== null && typeof body === 'object' && !Array.isArray(body);

		// A 5xx with a JSON body is still worth reading — GetCourse answers its own
		// errors with 200, so a 500 carrying an envelope is unusual but informative.
		if (status >= 500 && !isEnvelope) {
			if (retryable && attempt < maxAttempts) {
				await sleep(Math.min(2 ** (attempt - 1) * 1000, 8000) + randomInt(250));
				continue;
			}

			throw new NodeOperationError(this.getNode(), `GetCourse returned ${status}`, {
				description: `The request to ${url} failed on GetCourse's side and the answer carried no API error to report.`,
			});
		}

		return assertEnvelope.call(this, body, url, status);
	}
}

/** Shared by every call: never follow a redirect, never throw on a 3xx or 4xx. */
const TRANSPORT_DEFAULTS = {
	json: true,
	returnFullResponse: true,
	disableFollowRedirect: true,
	ignoreHttpStatusErrors: true,
} as const;

/**
 * An import call: `POST /pl/api/users` or `POST /pl/api/deals`.
 *
 * The body is form-encoded by hand rather than handed to the HTTP helper as an
 * object, because GetCourse reads three form fields and nothing else, and one of
 * them — `params` — is base64 of a JSON document. Base64 contains `+`, `/` and
 * `=`, all of which mean something else in a form body, so it is percent-encoded
 * on top. Getting that wrong is the cause of the platform's own FAQ entry about
 * «Не указаны параметры».
 */
export async function importRequest(
	this: LegacyContext,
	endpoint: string,
	action: string,
	params: IDataObject,
): Promise<LegacyEnvelope> {
	const account = await resolveAccount.call(this);
	const encoded = Buffer.from(JSON.stringify(params), 'utf8').toString('base64');

	const body = [
		`action=${encodeURIComponent(action)}`,
		`key=${encodeURIComponent(account.schoolKey)}`,
		`params=${encodeURIComponent(encoded)}`,
	].join('&');

	// Imports are metered monthly rather than per second, but a burst still
	// deserves a queue: a thousand-item workflow otherwise opens a thousand
	// sockets at once.
	await acquireSlot(`${account.baseUrl}|import`, 5, 1000);

	const envelope = await send.call(
		this,
		{
			...TRANSPORT_DEFAULTS,
			method: 'POST',
			baseURL: account.baseUrl,
			url: endpoint,
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body,
		},
		false,
	);

	return assertSuccess.call(this, envelope);
}

export interface ExportRequestOptions {
	/** Return a "not ready yet" answer instead of throwing on it. */
	allowPending?: boolean;
	/** How long the caller may queue for a budget slot before giving up. */
	maxWaitMs?: number;
	/** Spend a slot from the export budget. */
	metered?: boolean;
}

/**
 * Takes one request from the account's export budget, or refuses.
 *
 * Bound per call so that `send` can charge every attempt, retries included.
 */
async function spendBudget(
	this: LegacyContext,
	account: AccountConnection,
	maxWaitMs: number,
	refusal?: { message: string; description: string },
): Promise<void> {
	const budgetKey = `${account.baseUrl}|export`;
	const allowed = await acquireSlot(
		budgetKey,
		account.exportRequestsPerHour,
		EXPORT_WINDOW_MS,
		maxWaitMs,
	);

	if (allowed) return;

	if (refusal !== undefined) {
		throw new NodeOperationError(this.getNode(), refusal.message, {
			description: refusal.description,
		});
	}

	const minutes = Math.ceil(
		slotDelay(budgetKey, account.exportRequestsPerHour, EXPORT_WINDOW_MS) / 60_000,
	);

	throw new NodeOperationError(
		this.getNode(),
		'The GetCourse export budget for this account is used up',
		{
			description:
				`The next slot frees up in about ${minutes} minutes. GetCourse allows 100 export ` +
				'requests per two hours per account and counts every status check; this node keeps to ' +
				'the rate set as "Export Requests per Hour" on the credential so that a poll loop ' +
				"cannot lock the school's other integrations out.",
		},
	);
}

/**
 * A call under `/pl/api/account/`.
 *
 * Every one of these — including a status poll that answers "not ready yet" —
 * counts against the account's 100-per-two-hours budget, which is why they go
 * through the throttle and why exceeding it is refused rather than queued
 * indefinitely. Whether the field dictionary is counted too is not documented,
 * so it is counted here: over-counting costs an occasional slot, under-counting
 * costs the whole account a two-hour lockout.
 */
export async function exportRequest(
	this: LegacyContext,
	endpoint: string,
	qs: IDataObject = {},
	options: ExportRequestOptions = {},
): Promise<LegacyEnvelope> {
	const account = await resolveAccount.call(this);
	const spend =
		options.metered === false
			? undefined
			: spendBudget.bind(this, account, options.maxWaitMs ?? MAX_BUDGET_WAIT_MS);

	const envelope = await send.call(
		this,
		{
			...TRANSPORT_DEFAULTS,
			method: 'GET',
			baseURL: account.baseUrl,
			url: endpoint,
			qs: { key: account.schoolKey, ...flattenQuery(qs) },
			headers: { Accept: 'application/json' },
		},
		true,
		spend,
	);

	if (options.allowPending === true && isExportPending(envelope)) return envelope;

	return assertSuccess.call(this, envelope);
}

/**
 * The custom-field dictionary: `POST /pl/api/account/fields`.
 *
 * Answers with the export envelope rather than the import one — `info` holds the
 * array of field descriptors — even though the request is shaped like an import.
 * Memoised, because the editor asks for it again on every parameter change.
 */
export async function fieldsRequest(this: LegacyContext): Promise<LegacyEnvelope> {
	const account = await resolveAccount.call(this);

	return await cached(`legacy|fields|${account.credentialId}`, async () => {
		const body = ['action=get', `key=${encodeURIComponent(account.schoolKey)}`].join('&');

		const envelope = await send.call(
			this,
			{
				...TRANSPORT_DEFAULTS,
				method: 'POST',
				baseURL: account.baseUrl,
				url: '/pl/api/account/fields',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Accept: 'application/json',
				},
				body,
			},
			true,
			spendBudget.bind(this, account, MAX_DROPDOWN_WAIT_MS, {
				message: 'The custom-field list cannot be read: the export budget is spent',
				description:
					'GetCourse counts this call against the same hundred-requests-per-two-hours budget as an export, and that budget is currently used up. The field name can be typed in by hand in the meantime.',
			}),
		);

		return assertSuccess.call(this, envelope);
	});
}

/** The same as {@link exportRequest}, memoised — for the group dropdown only. */
export async function cachedExportRequest(
	this: LegacyContext,
	endpoint: string,
	qs: IDataObject = {},
): Promise<LegacyEnvelope> {
	const account = await resolveAccount.call(this);
	const key = `legacy|${account.credentialId}|${endpoint}|${JSON.stringify(qs)}`;

	return await cached(
		key,
		async () => await exportRequest.call(this, endpoint, qs, { maxWaitMs: MAX_DROPDOWN_WAIT_MS }),
	);
}
