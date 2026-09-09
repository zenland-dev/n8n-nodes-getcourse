import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

// The account-wide custom-field dictionary lives on the legacy API and nowhere
// else. Both nodes have shared one credential since 0.2.1, so reading it from
// here costs nothing but this import — see `accountFieldOptions` below.
import { fieldsRequest } from '../../../GetCourseLegacy/v1/transport';
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
 * `techUserFieldOptions` and `accountFieldOptions` below for where theirs comes
 * from.
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
 * One descriptor from `POST /pl/api/account/fields`, as far as this file cares.
 *
 * `id` and `field_order_pos` come back as numbers, `title` and `context_type` as
 * strings, and `context_type` is `user` or `deal` and nothing else. Everything
 * stays optional because a dictionary is account data, not a contract.
 */
interface FieldDescriptor {
	id?: string | number;
	title?: string;
	type?: string;
	context_type?: string;
	field_order_pos?: string | number;
}

/**
 * GetCourse splices five `gc_system_*` fields of its own into each context. They
 * are still offered — a workflow may want a UTM value — but they do not belong
 * above the fields somebody actually defined.
 */
function sortFieldOptions(rows: INodePropertyOptions[]): INodePropertyOptions[] {
	return [...rows].sort((left, right) => {
		const bySystem =
			Number(SYSTEM_FIELD.test(String(left.name))) - Number(SYSTEM_FIELD.test(String(right.name)));
		if (bySystem !== 0) return bySystem;

		return String(left.name).localeCompare(String(right.name));
	});
}

/**
 * The account's custom fields, by numeric id — which is what the Tech API writes.
 *
 * The always-works route, and the only one for orders. `POST /pl/api/account/fields`
 * lists the whole account, both contexts at once, and the ids it reports are
 * exactly the ids the Tech API's `update-custom-fields` takes — checked field for
 * field on a live account. It depends on nothing else on the panel, which the
 * first version of this picker did: it read the list from the user or the order
 * the operation names, so it refused to open until that identifier was filled in,
 * and an identifier written as an expression does not resolve while the editor is
 * merely open. A picker must not depend on the form it exists to fill in.
 *
 * Reaching across to the other node's transport is fine now that both nodes share
 * one credential; before 0.2.1 they did not, and that, rather than anything
 * technical, is why this was not done from the start.
 *
 * The cost is the export budget: this call is counted against the account's
 * hundred requests per two hours, like every other `/pl/api/account/` read, which
 * is why `techUserFieldOptions` above is tried first for the user context.
 * `fieldsRequest` memoises it for two minutes and refuses quickly rather than
 * queueing when the budget is spent, so a dropdown cannot lock a school out of
 * its own API.
 */
async function accountFieldOptions(
	this: ILoadOptionsFunctions,
	context: 'user' | 'deal',
): Promise<INodePropertyOptions[]> {
	const envelope = await fieldsRequest.call(this);
	const info = envelope.info;
	const all: FieldDescriptor[] = Array.isArray(info) ? (info as FieldDescriptor[]) : [];

	// `context_type` was `user` or `deal` on every descriptor a live account
	// returned. If a school ever answers something else, showing the whole
	// dictionary beats showing an empty list: the ids are still correct and the
	// description below says which context each field belongs to.
	const scoped = all.filter((field) => String(field.context_type ?? '') === context);
	const fields = scoped.length > 0 ? scoped : all;
	const showContext = scoped.length === 0;

	const rows = fields
		.filter((field) => field.id !== undefined && String(field.title ?? '') !== '')
		.map((field) => ({
			name: String(field.title),
			value: String(field.id),
			description: [
				`ID ${String(field.id)}`,
				String(field.type ?? ''),
				showContext ? String(field.context_type ?? '') : '',
			]
				.filter((part) => part !== '')
				.join(' · '),
		}));

	return sortFieldOptions(rows);
}

/**
 * Picks the steadiest person in the personal-manager list to ask about fields.
 *
 * The list is whoever the school configured as a personal manager, not its whole
 * staff, so what it contains varies: one account answered 121 people — 74 with
 * `type: admin`, 45 plain users, 2 teachers — and another answered a single
 * teacher, its account owner nowhere in it. Any of them gives the same field
 * list, so the choice only matters for how likely the record is to still be
 * there tomorrow: an admin outlives a customer who was made a manager once.
 *
 * Deleted records are skipped outright — GetCourse keeps them with
 * `deleted: true`, and asking about one wastes the free route and falls through
 * to the metered dictionary for no reason.
 */
function sampleUserId(managers: IDataObject[]): string {
	const usable = managers.filter(
		(row) => row.deleted !== true && String(row.id ?? '') !== '',
	);
	if (usable.length === 0) return '';

	const admin = usable.find((row) => String(row.type ?? '') === 'admin');
	return String((admin ?? usable[0]).id);
}

/**
 * The user's custom fields, read from the Tech API and costing nothing.
 *
 * `get-custom-fields` lists every field the account defines for the user
 * context — values null where the person has none — but it insists on naming a
 * person, and there is no user listing anywhere in this API. `get-personal-managers`
 * is the way round that: it answers full user records and takes no parameters,
 * so the first manager serves as a sample. Which person is asked does not matter,
 * because the answer describes the account rather than them; that was checked on
 * two accounts, where the manager route returned 13 and 106 fields against 13 and
 * 106 user-context descriptors in the legacy dictionary.
 *
 * Worth the two extra round trips because both are on the Tech API, which has no
 * published quota, while the legacy dictionary spends one of the hundred Export
 * requests the whole school shares every two hours.
 *
 * Returns null rather than throwing on anything unexpected — an account with no
 * personal managers included — so the caller falls back to the dictionary that
 * always works. Silence is safe here only because it is a fallback and not an
 * answer.
 */
async function techUserFieldOptions(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[] | null> {
	try {
		const managers = (await techApiCachedRequest.call(
			this,
			'/common/get-personal-managers',
		)) as unknown;

		if (!Array.isArray(managers) || managers.length === 0) return null;

		const userId = sampleUserId(managers as IDataObject[]);
		if (userId === '') return null;

		const data = (await techApiCachedRequest.call(this, '/user/get-custom-fields', {
			userId,
		})) as unknown;

		// The user endpoint answers an object keyed by field id, entries
		// `{name, value, type, units}`. The deal one answers an array instead, which
		// is why that context is not routed through here at all.
		if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;

		const rows = Object.entries(data as IDataObject).map(([id, entry]) => {
			const row = (entry ?? {}) as IDataObject;
			return {
				name: String(row.name ?? '') || id,
				value: id,
				description: [`ID ${id}`, String(row.type ?? '')].filter((p) => p !== '').join(' · '),
			};
		});

		return rows.length === 0 ? null : sortFieldOptions(rows);
	} catch {
		// A missing developer key, a 403, an account that answers something else —
		// all of them mean "ask the dictionary instead", and the dictionary reports
		// its own failures properly.
		return null;
	}
}

export async function getUserCustomFieldIds(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	// The Tech API first, because it costs the account nothing; the dictionary
	// only when that route is unavailable, because it spends export budget.
	return (await techUserFieldOptions.call(this)) ?? (await accountFieldOptions.call(this, 'user'));
}

export async function getDealCustomFieldIds(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return await accountFieldOptions.call(this, 'deal');
}
