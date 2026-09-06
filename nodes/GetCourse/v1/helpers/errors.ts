import type { IDataObject, INode, JsonObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { extractResponseBody, extractStatusCode } from '../../../../utils/httpError';

/** The envelope every Tech API endpoint answers with, success or failure. */
export interface TechApiEnvelope {
	status?: boolean;
	message?: string | null;
	code?: number;
	errors?: unknown;
	data?: unknown;
}

/** Turns the `errors` member into something a person can read. */
function describeErrors(errors: unknown): string {
	if (errors === null || errors === undefined) return '';

	if (Array.isArray(errors)) {
		return errors
			.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry)))
			.filter((entry) => entry !== '')
			.join('\n');
	}

	if (typeof errors === 'object') {
		// A validation failure arrives keyed by field: { email: ["не заполнено"] }.
		return Object.entries(errors as IDataObject)
			.map(
				([field, detail]) =>
					`${field}: ${Array.isArray(detail) ? detail.join(', ') : String(detail)}`,
			)
			.join('\n');
	}

	return String(errors);
}

/**
 * Turns a Tech API failure into a NodeApiError a user can act on.
 *
 * The platform's own messages are short and Russian ("Нет доступа"), and its 403
 * covers both halves of the token being wrong as well as the school simply not
 * having granted access, so the mapping below spells the causes out rather than
 * passing the status through.
 */
export function toTechApiError(node: INode, error: unknown, status?: number): NodeApiError {
	if (error instanceof NodeApiError && status === undefined) return error;

	const httpCode = status ?? extractStatusCode(error);
	const body = (extractResponseBody(error) ?? {}) as TechApiEnvelope;

	const reported = typeof body.message === 'string' && body.message !== '' ? body.message : '';
	const details = describeErrors(body.errors);

	let message = reported === '' ? 'GetCourse request failed' : reported;
	let description = details;

	switch (httpCode) {
		case 400:
			message = 'GetCourse rejected the request';
			description =
				// `reported` is '' rather than undefined when the body carried no message,
				// so the fallback has to be `||` — `??` would never fire.
				details === ''
					? reported || 'The request did not pass validation.'
					: `${reported}\n${details}`;
			break;
		case 401:
		case 403:
			message = 'GetCourse refused the credentials';
			description =
				'The Tech API token is the developer key and the school key joined by an underscore. A 403 means one of the two halves is wrong, they belong to different schools, or the school has not enabled API access for this developer key.\n' +
				details;
			break;
		case 404:
			message = 'GetCourse found nothing at that address';
			description =
				description === ''
					? 'The object ID may be wrong, or the method may not exist on this account version.'
					: description;
			break;
		case 429:
			message = 'GetCourse rate limit exceeded';
			description =
				'The account went over its request budget and the retries did not clear it. Lower "Requests per Second" on the credential, or reduce how many workflows call this account at once.';
			break;
		default:
			if (httpCode !== undefined && httpCode >= 500) {
				message = 'GetCourse returned a server error';
			}
	}

	return new NodeApiError(node, asPlainError(error), {
		message,
		description: description.trim() === '' ? undefined : description.trim(),
		httpCode: httpCode === undefined ? undefined : String(httpCode),
	});
}

/**
 * Flattens an error into something the NodeApiError constructor will re-shape.
 *
 * Handed a NodeApiError, that constructor returns the original untouched — a
 * deliberate choice in n8n, so that a node re-throwing what a shared helper
 * already wrapped does not wrap it twice. The effect here is the opposite of
 * what is wanted: the mapping above would be computed and then silently
 * discarded, leaving the platform's own terse Russian message in place of the
 * explanation. Passing a plain object keeps the mapping.
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
 * A 200 that carries `status: false`.
 *
 * Not every Tech API failure is an HTTP error: some endpoints answer 200 with
 * the envelope's own flag turned off, so the body has to be checked as well as
 * the status line.
 */
export function envelopeError(node: INode, envelope: TechApiEnvelope): NodeApiError {
	const details = describeErrors(envelope.errors);
	const reported = typeof envelope.message === 'string' ? envelope.message : '';

	return new NodeApiError(node, envelope as JsonObject, {
		message: reported === '' ? 'GetCourse reported a failure' : reported,
		description: details === '' ? undefined : details,
		httpCode: envelope.code === undefined ? undefined : String(envelope.code),
	});
}
