import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { techApiCachedRequest } from '../transport';

/**
 * The dictionaries the Tech API publishes.
 *
 * All but one take no parameters and return a small flat array, which makes
 * them exactly the right shape for a dropdown; offers are the exception and
 * have to be paged. Everything else an operation might want an ID for — diploma
 * templates, surveys, lessons, products — has no listing endpoint anywhere in
 * the API, so those stay plain inputs rather than pickers that would always be
 * empty. Custom fields used to be on that list and no longer are; see
 * `customFieldOptions` below for the listing that was hiding in plain sight.
 */
async function dictionary(this: ILoadOptionsFunctions, endpoint: string): Promise<IDataObject[]> {
	const data = (await techApiCachedRequest.call(this, endpoint)) as unknown;
	return Array.isArray(data) ? (data as IDataObject[]) : [];
}

function toOptions(
	rows: IDataObject[],
	label: (row: IDataObject) => string,
	describe?: (row: IDataObject) => string,
): INodePropertyOptions[] {
	return rows
		.map((row) => ({
			name: label(row) || String(row.id ?? ''),
			value: row.id as string | number,
			description: describe?.(row),
		}))
		.filter((option) => option.value !== undefined && option.name !== '')
		.sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

export async function getGroups(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return toOptions(await dictionary.call(this, '/common/get-groups'), (row) =>
		String(row.name ?? ''),
	);
}

/** Departments carry their label in `title`, not `name`, unlike everything else. */
export async function getDepartments(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return toOptions(await dictionary.call(this, '/common/get-departments'), (row) =>
		String(row.title ?? row.name ?? ''),
	);
}

/**
 * Managers come back as complete user records, and both name halves are
 * nullable — hence the e-mail fallback rather than a row labelled " ".
 */
export async function getManagers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return toOptions(
		await dictionary.call(this, '/common/get-personal-managers'),
		(row) => {
			const name = `${String(row.first_name ?? '')} ${String(row.last_name ?? '')}`.trim();
			return name === '' ? String(row.email ?? '') : name;
		},
		(row) => String(row.email ?? ''),
	);
}

export async function getCancelReasons(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return toOptions(await dictionary.call(this, '/deal/get-cancel-reasons'), (row) =>
		String(row.name ?? ''),
	);
}

export async function getWebinars(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return toOptions(
		await dictionary.call(this, '/webinar/get-all-webinars'),
		(row) => {
			const params = (row.params ?? {}) as IDataObject;
			return String(row.name ?? params.title ?? '');
		},
		(row) => String(row.status ?? ''),
	);
}

/**
 * Offers are the one dictionary that pages, and the API reports no total.
 *
 * So it is walked until a short page arrives, and capped: an account with
 * thousands of offers should not hang the editor while the list loads, and a
 * dropdown that long is the wrong control anyway.
 */
export async function getOffers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const pageSize = 100;
	const maxPages = 20;
	const rows: IDataObject[] = [];

	for (let page = 0; page < maxPages; page++) {
		const batch = (await techApiCachedRequest.call(this, '/offer/get-offers', {
			limit: pageSize,
			offset: page * pageSize,
		})) as unknown;

		if (!Array.isArray(batch) || batch.length === 0) break;
		rows.push(...(batch as IDataObject[]));

		if (batch.length < pageSize) break;
	}

	return toOptions(
		rows,
		(row) => {
			const code = String(row.code ?? '');
			return code === '' ? String(row.title ?? '') : `${String(row.title ?? '')} [${code}]`;
		},
		(row) => {
			const price = row.price === undefined ? '' : String(row.price);
			const currency = String(row.currency ?? '');
			return [price, currency].filter((part) => part !== '').join(' ');
		},
	);
}

/** Fields GetCourse creates for itself, which no account asked for. */
const SYSTEM_FIELD = /^gc_system_/;

/**
 * Flattens whichever of the two shapes `get-custom-fields` answered with.
 *
 * The two endpoints do not agree, and it is not a subtle difference. On a live
 * account with the same thirteen fields defined for each context:
 *
 * - `/user/get-custom-fields` answers an **object keyed by field id**, entries
 *   `{name, value, type, units}` — the id is the key and appears nowhere inside;
 * - `/deal/get-custom-fields` answers a **plain array**, entries
 *   `{name, id, value, type}` — the id is a field of the entry and there is no
 *   `units`.
 *
 * Reading only the first shape is what an assumption of symmetry costs: the
 * order picker silently offered nothing at all. Both are handled here, and
 * anything that is neither yields no rows rather than throwing, because an
 * unfamiliar shape should leave the user typing an id — which still works —
 * rather than blocking the panel.
 */
function toFieldRows(data: unknown): Array<{ id: string; row: IDataObject }> {
	if (Array.isArray(data)) {
		return (data as IDataObject[])
			.map((row) => ({ id: String(row?.id ?? ''), row: row ?? {} }))
			.filter((entry) => entry.id !== '');
	}

	if (data !== null && typeof data === 'object') {
		return Object.entries(data as IDataObject).map(([id, entry]) => ({
			id,
			row: (entry ?? {}) as IDataObject,
		}));
	}

	return [];
}

/**
 * The custom-field dictionary the Tech API does not admit to publishing.
 *
 * There is no account-wide listing of custom fields anywhere in this API, which
 * is why the editor used to ask for a bare number. But `get-custom-fields` is
 * one in disguise: whichever shape it answers with, it enumerates **every**
 * field the account defines for that context, `value: null` where the object
 * has none. So one read of any existing object gives id → name for the account.
 *
 * The cost is that the dropdown needs an object to read it from, which is why
 * these depend on the identifier the operation already asks for. That is also
 * the reason for reading it live rather than caching it per credential: two
 * users answer the same field list, but the request has to name one of them.
 */
async function customFieldOptions(
	this: ILoadOptionsFunctions,
	endpoint: string,
	qs: IDataObject,
): Promise<INodePropertyOptions[]> {
	const data = (await techApiCachedRequest.call(this, endpoint, qs)) as unknown;

	return toFieldRows(data)
		.map(({ id, row }) => ({
			name: String(row.name ?? '') || id,
			value: id,
			description: [`ID ${id}`, String(row.type ?? '')].filter((part) => part !== '').join(' · '),
		}))
		.sort((left, right) => {
			// GetCourse splices five `gc_system_*` fields of its own into every
			// account's user context. They are still offered — a workflow may want a
			// UTM value — but they do not belong above the fields somebody defined.
			const bySystem = Number(SYSTEM_FIELD.test(left.name)) - Number(SYSTEM_FIELD.test(right.name));
			if (bySystem !== 0) return bySystem;

			return left.name.localeCompare(right.name);
		});
}

/**
 * Reads whichever identifier the User operations are currently set to.
 *
 * An expression reaches this resolved, or not at all — either way an empty
 * value means the dropdown has nothing to read the account's fields with, and
 * saying so beats an empty list that looks like an account with no fields.
 */
function currentUser(this: ILoadOptionsFunctions): IDataObject {
	const by = String(this.getCurrentNodeParameter('identifyBy') ?? 'userId');
	const value = String(this.getCurrentNodeParameter(by) ?? '').trim();

	if (value === '') {
		throw new NodeOperationError(this.getNode(), 'Name a user first', {
			description:
				'This list is read from a user, because the Tech API has no account-wide listing of custom fields. Fill in the ID, e-mail or phone number above and open the list again — any existing user answers with the whole set of fields the account defines.',
		});
	}

	return { [by]: value };
}

export async function getUserCustomFieldIds(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return await customFieldOptions.call(this, '/user/get-custom-fields', currentUser.call(this));
}

export async function getDealCustomFieldIds(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const dealId = String(this.getCurrentNodeParameter('dealId') ?? '').trim();

	if (dealId === '') {
		throw new NodeOperationError(this.getNode(), 'Name an order first', {
			description:
				'This list is read from an order, because the Tech API has no account-wide listing of custom fields. Fill in the Order ID above and open the list again — any existing order answers with the whole set of fields the account defines.',
		});
	}

	return await customFieldOptions.call(this, '/deal/get-custom-fields', { dealId });
}
