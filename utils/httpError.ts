import type { IDataObject } from 'n8n-workflow';

/**
 * A failure reaches a node in whichever shape the HTTP layer happened to wrap
 * it in, and that shape has changed between n8n releases. Rather than guess one,
 * these read every place the interesting value has ever lived.
 */

/** Pulls the HTTP status out of whatever shape the failure arrived in. */
export function extractStatusCode(error: unknown): number | undefined {
	const candidates = [
		(error as IDataObject)?.httpCode,
		((error as IDataObject)?.response as IDataObject)?.status,
		(error as IDataObject)?.statusCode,
		(((error as IDataObject)?.cause as IDataObject)?.response as IDataObject)?.status,
		((error as IDataObject)?.cause as IDataObject)?.statusCode,
		((error as IDataObject)?.context as IDataObject)?.statusCode,
	];

	for (const candidate of candidates) {
		const parsed = Number(candidate);
		if (Number.isFinite(parsed) && parsed >= 100 && parsed < 600) return parsed;
	}

	return undefined;
}

/** Pulls the response body out of whatever shape the failure arrived in. */
export function extractResponseBody(error: unknown): IDataObject | undefined {
	const candidates = [
		((error as IDataObject)?.response as IDataObject)?.data,
		((error as IDataObject)?.response as IDataObject)?.body,
		(((error as IDataObject)?.cause as IDataObject)?.response as IDataObject)?.data,
		((error as IDataObject)?.cause as IDataObject)?.error,
		(error as IDataObject)?.error,
	];

	for (const candidate of candidates) {
		if (candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)) {
			return candidate as IDataObject;
		}
	}

	return undefined;
}

/** Reads `Retry-After` (seconds) if the server bothered to send one. */
export function extractRetryAfterMs(error: unknown): number | undefined {
	const headers =
		(((error as IDataObject)?.response as IDataObject)?.headers as IDataObject) ??
		((((error as IDataObject)?.cause as IDataObject)?.response as IDataObject)
			?.headers as IDataObject);

	const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
	const seconds = Number(raw);

	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}
