import type { IDataObject, INode, JsonObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { extractResponseBody, extractStatusCode } from '../../../../utils/httpError';

/**
 * The two envelopes the legacy API answers with.
 *
 * The import endpoints (`/pl/api/users`, `/pl/api/deals`) put a plain `error`
 * string at the top level when the call itself fails, and an object under
 * `result` when the call was understood but the operation did not succeed. The
 * export endpoints (`/pl/api/account/…`, `/pl/api/account/fields` included) use
 * `info` plus `error_message` and a numeric `error_code`.
 *
 * `error` is polymorphic across the two: a boolean in the export envelope, a
 * message string in the import one. Both are read below.
 */
export interface LegacyEnvelope {
	success?: boolean | string;
	action?: string;
	error?: boolean | string;
	error_message?: string;
	error_code?: number | string;
	info?: unknown;
	result?: unknown;
}

/**
 * `"true"`, `true`, `1` — the legacy API is not consistent about which it sends.
 *
 * The help page documents these as the strings `"true"`/`"false"`; the live API
 * sends JSON booleans in some places and numbers in others. Comparing with
 * `=== true` would read a successful import as a failure.
 */
export function isTruthyFlag(value: unknown): boolean {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value !== 0;
	if (typeof value !== 'string') return false;

	const text = value.trim().toLowerCase();
	return text !== '' && text !== 'false' && text !== '0';
}

/** Numeric `error_code`, whichever way it was typed. */
export function errorCodeOf(envelope: LegacyEnvelope): number | undefined {
	const parsed = Number(envelope.error_code);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** Everything the API might have called an error message, in one string. */
export function errorTextOf(envelope: LegacyEnvelope): string {
	const parts = [
		typeof envelope.error === 'string' ? envelope.error : '',
		envelope.error_message ?? '',
	].filter((part) => part !== '');

	return [...new Set(parts)].join('\n');
}

/**
 * What each error code the service is known to return actually means.
 *
 * GetCourse documents almost none of these numerically. 903 is named in the help
 * page's troubleshooting list; 901, 904, 905, 908, 909, 913, 914 and 918 were
 * read off a live account, each one reproduced deliberately. 917 is the only
 * code below still taken on trust from clients that evidently run against the
 * service. The message text is localised — an account on getcourse.io answers
 * 901 with "Access denied" — so the code is matched first and the text only as a
 * fallback, and every branch that has a code carries one.
 */
function describeCode(code: number | undefined, text: string): string | undefined {
	if (code === 901 || text.includes('Неавторизованное') || text.includes('Access denied')) {
		return 'Either the secret key is wrong or the account address is. A key belongs to one account; if the account force-redirects to its own domain, the credential has to use that domain.';
	}

	if (code === 903 || text.includes('Слишком много запросов')) {
		return 'The Export API allows 100 requests per two hours per account, and every status check counts. Wait for the window to clear, and lower "Export Requests per Hour" on the credential if this keeps happening.';
	}

	// The single most likely failure of a real integration, and the one the node
	// can do least about: the lock is account-wide, so another workflow — or
	// another product entirely, pointed at the same school — can hold it. Since
	// GetCourse checks it before it validates anything else, a 905 also means
	// nothing was started and no file exists to collect.
	if (code === 905 || text.includes('Уже запущен')) {
		return 'GetCourse builds one export at a time per account and refuses a second while one is still being built — including one started by another workflow, or by another integration on the same school. Nothing was started, so there is no export to collect. Feed this node a single item (Settings → Execute Once), or run the items through a Loop Over Items with a Wait node, or use "Export and Wait" so each export finishes before the next begins. Turning on Settings → On Error → Continue keeps the export IDs earlier items already returned instead of losing them with the run.';
	}

	if (
		code === 904 ||
		text.includes('отсутсвует параметр key') ||
		text.includes('отсутствует параметр key')
	) {
		return 'The request reached GetCourse without a key. Check that the credential has its Secret Key filled in.';
	}

	if (code === 917 || text.includes('Функционал недоступен')) {
		return 'The Import/Export API is switched off for this account. It is available on paid plans only, and the account owner has to generate a key under Профиль → Настройки аккаунта → АПИ.';
	}

	if (text.includes('Действие запрещено')) {
		return 'The key is read-only. Imports need a key generated with write access.';
	}

	if (text.includes('Достигнут лимит')) {
		return 'The account has used up its monthly allowance for creating objects through the API. The allowance depends on the GetCourse plan; updates to existing objects do not count against it.';
	}

	if (text.includes('Файл не создан')) {
		return 'No object matched the filter, so GetCourse produced no export file. Widen the filter, or check in the account that the objects exist.';
	}

	// Reached only if a 909 escapes the polling path, which passes allowPending
	// and treats this as a state rather than a failure. It is here so that the
	// taxonomy has no hole: an unexplained «Файл еще не создан» reads like a
	// permanent error when it is the opposite.
	if (code === 909 || text.includes('еще не создан')) {
		return 'The export is still being built — this is a stage, not a failure. Give GetCourse longer: raise "Give Up After" on Export and Wait, or put a Wait node in front of Get Result. The ID stays valid, so the file can be collected by a later run.';
	}

	if (code === 908 || text.includes('хотя бы один фильтр')) {
		return 'GetCourse refuses an export with no filter at all. Give at least one — a created-from date is the usual choice. A parameter GetCourse does not recognise as a filter does not satisfy the rule either, and is answered the same way: on the user export, `type` is one such parameter and is ignored.';
	}

	// The server names its own vocabulary in the message — «попробуйте один из -
	// active,deactivated,banned,invited,in_base» — which is the only published
	// source for these lists. Repeating them here would go stale; pointing at the
	// message does not.
	if (code === 913 || code === 914 || code === 918 || text.includes('поле статус')) {
		return 'The status filter carries a value this export does not accept. GetCourse lists the ones it does in the message above, and the three sets differ: users, orders and payments each have their own.';
	}

	if (text.includes('Пустой параметр action')) {
		return 'GetCourse read no action on the request. The usual cause is a redirect: an account with a forced domain redirect turns the POST into a GET and loses its body, so the credential has to name the custom domain.';
	}

	if (text.includes('Доступ возможен только по https')) {
		return 'The request was made over plain HTTP. This node always uses HTTPS, so this points at a proxy in front of n8n rewriting the scheme.';
	}

	return undefined;
}

/** Turns a transport-level failure into a NodeApiError a user can act on. */
export function toLegacyApiError(node: INode, error: unknown, status?: number): NodeApiError {
	if (error instanceof NodeApiError && status === undefined) return error;

	const httpCode = status ?? extractStatusCode(error);
	const body = (extractResponseBody(error) ?? {}) as LegacyEnvelope;
	const text = errorTextOf(body);

	let message = text === '' ? 'GetCourse request failed' : text;
	let description = describeCode(errorCodeOf(body), text);

	if (httpCode === 404 && text === '') {
		message = 'GetCourse does not know that account';
		description =
			'An address that is not a GetCourse account answers 404 with the plain text "Wrong subdomain". Check the account address on the credential.';
	}

	if (httpCode !== undefined && httpCode >= 500 && text === '') {
		message = 'GetCourse returned a server error';
	}

	return new NodeApiError(node, asPlainError(error), {
		message,
		description,
		httpCode: httpCode === undefined ? undefined : String(httpCode),
	});
}

/**
 * Flattens an error into something the NodeApiError constructor will re-shape.
 *
 * Handed a NodeApiError, that constructor returns the original untouched, so the
 * mapping above would be computed and then thrown away — leaving GetCourse's own
 * terse message where the explanation should be. Passing a plain object keeps it.
 */
function asPlainError(error: unknown): JsonObject {
	if (!(error instanceof NodeApiError)) return error as JsonObject;

	return {
		message: error.message,
		description: (error as unknown as { description?: string }).description ?? null,
		httpCode: error.httpCode,
	} as unknown as JsonObject;
}

/**
 * A 200 whose body says the call failed.
 *
 * The legacy API answers almost everything with HTTP 200 — a wrong key, a
 * disabled account and an exhausted rate limit all arrive as a cheerful 200 with
 * `success: false` in the body. Checking the status line alone would let every
 * one of them pass as a result.
 */
export function envelopeError(node: INode, envelope: LegacyEnvelope): NodeApiError {
	const text = errorTextOf(envelope);
	const code = errorCodeOf(envelope);

	return new NodeApiError(node, envelope as JsonObject, {
		message: text === '' ? 'GetCourse reported a failure' : text,
		description: describeCode(code, text),
		httpCode: code === undefined ? undefined : String(code),
	});
}

/**
 * The inner verdict of an import call.
 *
 * `POST /pl/api/users` answers `success: true` as long as it understood the
 * request, and reports whether anything was actually written inside `result` —
 * the platform's own troubleshooting page shows a failed import returning
 * `"success": true` with `result.error: true` beneath it. Both levels have to be
 * checked, or a rejected import reads as a success.
 */
export function importResultError(node: INode, envelope: LegacyEnvelope): NodeApiError | undefined {
	if (envelope.result === null || typeof envelope.result !== 'object') return undefined;

	const result = envelope.result as IDataObject;
	const failed =
		isTruthyFlag(result.error) || (result.success !== undefined && !isTruthyFlag(result.success));

	if (!failed) return undefined;

	const text = String(result.error_message ?? '').trim();

	return new NodeApiError(node, envelope as JsonObject, {
		message: text === '' ? 'GetCourse rejected the import' : text,
		description: describeCode(undefined, text),
	});
}

/**
 * Whether an export result response means "still being built".
 *
 * The distinction is the whole polling loop: `Файл еще не создан` is transient
 * and `Файл не создан, попробуйте другой фильтр` is permanent, and both contain
 * the substring "не создан". Matching on that alone spins forever on an empty
 * result — so the code is checked first and the message only in its longer,
 * unambiguous form.
 */
export function isExportPending(envelope: LegacyEnvelope): boolean {
	if (errorCodeOf(envelope) === 909) return true;
	if (isTruthyFlag(envelope.success)) return false;

	return errorTextOf(envelope).includes('еще не создан');
}
