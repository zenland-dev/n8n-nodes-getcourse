import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { techApiCachedRequest } from '../transport';

/**
 * The dictionaries the Tech API publishes.
 *
 * All but one take no parameters and return a small flat array, which makes
 * them exactly the right shape for a dropdown; offers are the exception and
 * have to be paged. Everything else an operation might want an ID for — diploma
 * templates, surveys, lessons, products, custom fields — has no listing endpoint
 * anywhere in the API, so those stay plain inputs rather than pickers that would
 * always be empty.
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
