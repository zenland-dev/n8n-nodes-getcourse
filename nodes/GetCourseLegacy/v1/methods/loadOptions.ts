import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { cachedExportRequest, fieldsRequest } from '../transport';

/** The group list: `info` is a plain array of `{ id, name, last_added_at }`. */
async function loadGroups(this: ILoadOptionsFunctions): Promise<IDataObject[]> {
	const envelope = await cachedExportRequest.call(this, '/pl/api/account/groups');
	const info = envelope.info;

	return Array.isArray(info) ? (info as IDataObject[]) : [];
}

function sortByName(rows: IDataObject[], key: string): IDataObject[] {
	return [...rows].sort((left, right) =>
		String(left[key] ?? '').localeCompare(String(right[key] ?? '')),
	);
}

/** `last_added_at` is null for a group nobody has ever been added to. */
function describeGroup(group: IDataObject): string {
	const addedAt = group.last_added_at;
	const when =
		addedAt === null || addedAt === undefined || addedAt === ''
			? 'empty'
			: `last added ${String(addedAt)}`;

	return `ID ${String(group.id ?? '?')} · ${when}`;
}

/** Groups by ID — for the export filters, which address a group numerically. */
export async function getGroups(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return sortByName(await loadGroups.call(this), 'name').map((group) => ({
		name: String(group.name ?? group.id ?? ''),
		value: group.id as string | number,
		description: describeGroup(group),
	}));
}

/**
 * Groups by name — for the import, which addresses a group by its title.
 *
 * The same list, a different value: `POST /pl/api/users` reads `group_name`, and
 * a numeric ID sent there would be taken for the name of a group to create.
 */
export async function getGroupNames(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return sortByName(await loadGroups.call(this), 'name')
		.filter((group) => String(group.name ?? '') !== '')
		.map((group) => ({
			name: String(group.name),
			value: String(group.name),
			description: describeGroup(group),
		}));
}

/**
 * One descriptor from `POST /pl/api/account/fields`.
 *
 * Every key here was present on every descriptor a live account returned, with
 * the types given: `id`, `required` and `field_order_pos` come back as numbers
 * rather than strings, and `params` is a JSON document that has been serialised
 * into a string — it is not an object and must be parsed before it is read.
 * They stay optional because a dictionary is account data, not a contract.
 */
interface FieldDescriptor {
	id?: string | number;
	title?: string;
	type?: string;
	context_type?: string;
	field_order_pos?: string | number;
	/** 0 or 1. Whether the account's own form requires the field. */
	required?: string | number;
	/** The form the field belongs to. */
	form_id?: string | number;
	/** Serialised JSON: `{settings, description, html_block, show_in_table, hide, …}`. */
	params?: string;
}

/**
 * Fields GetCourse creates for itself, which no account asked for.
 *
 * A live account returned five of them — `gc_system_user_utm_source` and its
 * four siblings — and they carry `field_order_pos` 0 to 4, so ordering by
 * position alone puts the platform's own bookkeeping above every field the
 * account actually defined. They are still offered, because a workflow may
 * genuinely want a UTM value; they are just no longer first.
 */
const SYSTEM_FIELD = /^gc_system_/;

async function loadFields(this: ILoadOptionsFunctions): Promise<FieldDescriptor[]> {
	const envelope = await fieldsRequest.call(this);
	const info = envelope.info;

	return Array.isArray(info) ? (info as FieldDescriptor[]) : [];
}

/**
 * Narrows the dictionary to the entity being edited.
 *
 * A live account answers `context_type` as exactly `user` or `deal`, so the
 * exact comparison is tried first and is what normally decides. The pattern
 * behind it is not dead weight: one account is not the platform, the value is
 * documented nowhere, and a school with a context this code has never seen
 * would otherwise get an empty dropdown. So there are three tiers — the exact
 * value, then the pattern, then the whole list — because an over-long list is a
 * nuisance while an empty one reads as a broken credential.
 */
function inContext(
	fields: FieldDescriptor[],
	context: string,
	pattern: RegExp,
): { fields: FieldDescriptor[]; narrowed: boolean } {
	const exact = fields.filter((field) => String(field.context_type ?? '') === context);
	if (exact.length > 0) return { fields: exact, narrowed: true };

	const matched = fields.filter((field) => pattern.test(String(field.context_type ?? '')));
	if (matched.length > 0) return { fields: matched, narrowed: true };

	return { fields, narrowed: false };
}

/**
 * Options carry the field TITLE as their value, because that is what the import
 * API's `addfields` object is keyed by. The ID is shown in the description, as
 * it is what the Tech API's custom-field writer wants instead.
 */
function toFieldOptions(fields: FieldDescriptor[], showContext: boolean): INodePropertyOptions[] {
	const sorted = [...fields].sort((left, right) => {
		// The account's own fields first, GetCourse's UTM bookkeeping after them,
		// each group then in the order the account arranged it.
		const bySystem =
			Number(SYSTEM_FIELD.test(String(left.title ?? ''))) -
			Number(SYSTEM_FIELD.test(String(right.title ?? '')));
		if (bySystem !== 0) return bySystem;

		const byPosition = Number(left.field_order_pos ?? 0) - Number(right.field_order_pos ?? 0);
		if (Number.isFinite(byPosition) && byPosition !== 0) return byPosition;

		return String(left.title ?? '').localeCompare(String(right.title ?? ''));
	});

	return sorted
		.filter((field) => String(field.title ?? '') !== '')
		.map((field) => ({
			name: String(field.title),
			value: String(field.title),
			// `context_type` is only worth a line when the list was not narrowed by
			// it: after a successful narrowing it reads the same on every option.
			description: [
				field.id === undefined ? '' : `ID ${String(field.id)}`,
				field.type === undefined ? '' : String(field.type),
				showContext && field.context_type !== undefined ? String(field.context_type) : '',
			]
				.filter((part) => part !== '')
				.join(' · '),
		}));
}

export async function getUserCustomFields(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const scoped = inContext(await loadFields.call(this), 'user', /user|пользоват/i);
	return toFieldOptions(scoped.fields, !scoped.narrowed);
}

export async function getDealCustomFields(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const scoped = inContext(await loadFields.call(this), 'deal', /deal|order|заказ/i);
	return toFieldOptions(scoped.fields, !scoped.narrowed);
}
