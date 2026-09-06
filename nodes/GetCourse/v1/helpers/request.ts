import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/**
 * Reads the user-identifier trio into the single key the API wants.
 *
 * The three fields share one selector, so exactly one of them is ever filled in;
 * this turns that into `{ userId }`, `{ email }` or `{ phone }`. Sending two at
 * once is what the selector exists to prevent — the platform does not document
 * which one would win.
 */
export function userIdentifier(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const by = String(this.getNodeParameter('identifyBy', itemIndex, 'userId'));
	const value = String(this.getNodeParameter(by, itemIndex, '') ?? '').trim();

	if (value === '') {
		throw new NodeOperationError(this.getNode(), 'No user named', {
			description:
				'Fill in the ID, e-mail or phone number the operation should look the user up by.',
			itemIndex,
		});
	}

	// `userId` is an integer in the schema; the others are strings. A numeric
	// string in an integer field is the sort of thing PHP forgives and stricter
	// validators do not — but `Number('Иван')` is NaN, and `JSON.stringify` turns
	// that into `null`, which reaches GetCourse as "no user named at all".
	if (by !== 'userId') return { [by]: value };

	return { userId: assertNumeric.call(this, value, 'user ID', itemIndex) };
}

/** A number the request body can carry, or an error that names the field. */
function assertNumeric(
	this: IExecuteFunctions,
	value: string,
	label: string,
	itemIndex: number,
): number {
	const parsed = Number(value);

	if (!Number.isFinite(parsed)) {
		throw new NodeOperationError(this.getNode(), `"${value}" is not a ${label}`, {
			description:
				`GetCourse expects a number here. Anything else is serialised as null, which the API ` +
				'reads as the field having been left out.',
			itemIndex,
		});
	}

	return parsed;
}

/** The same trio as query parameters, for the endpoints that take them that way. */
export function userIdentifierQuery(this: IExecuteFunctions, itemIndex: number): IDataObject {
	return userIdentifier.call(this, itemIndex);
}

/** Reads the order id, refusing the blank that would otherwise reach the API. */
export function dealId(this: IExecuteFunctions, itemIndex: number): number {
	const raw = String(this.getNodeParameter('dealId', itemIndex, '') ?? '').trim();

	if (raw === '') {
		throw new NodeOperationError(this.getNode(), 'No order named', {
			description: 'Give the numeric GetCourse order ID.',
			itemIndex,
		});
	}

	return assertNumeric.call(this, raw, 'order ID', itemIndex);
}

/**
 * Turns the custom-field editor into the `{ "<id>": value }` object the API takes.
 *
 * Rows without an id are skipped rather than sent as `{"": …}`, which the server
 * accepts and silently ignores.
 */
export function customFieldsPayload(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const collection = this.getNodeParameter('customFieldsUi', itemIndex, {}) as IDataObject;
	const rows = (collection.field ?? []) as IDataObject[];
	const payload: IDataObject = {};

	for (const row of rows) {
		const id = String(row.id ?? '').trim();
		if (id === '') continue;
		payload[id] = row.value ?? '';
	}

	return payload;
}

/**
 * Normalises whatever an endpoint put in `data` into output items.
 *
 * The Tech API is inconsistent about this on purpose-built endpoints as well as
 * by accident: `GET /user/get-fields` answers with a bare object for one match
 * and an array for several, several writes answer with an empty array that means
 * "done", and one endpoint answers `null`. Mapping `data` straight to items
 * would emit nothing at all for a successful write.
 */
export function toItems(data: unknown, fallback: IDataObject = { success: true }): IDataObject[] {
	if (data === null || data === undefined) return [fallback];

	if (Array.isArray(data)) {
		if (data.length === 0) return [fallback];

		return data.map((entry) =>
			entry !== null && typeof entry === 'object' && !Array.isArray(entry)
				? (entry as IDataObject)
				: { value: entry },
		);
	}

	if (typeof data === 'object') return [data as IDataObject];

	return [{ value: data }];
}

/** Applies a client-side cap to an endpoint that has no server-side one. */
export function applyLimit(rows: IDataObject[], returnAll: boolean, limit: number): IDataObject[] {
	return returnAll ? rows : rows.slice(0, Math.max(1, limit));
}
