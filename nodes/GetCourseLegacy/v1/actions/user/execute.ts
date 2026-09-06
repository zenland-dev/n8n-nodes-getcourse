import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { toGetCourseDateTime } from '../../../../../utils/dates';
import { omitEmpty } from '../../../../../utils/query';
import { unknownOperation } from '../../../../../utils/router';
import { importResultError } from '../../helpers/errors';
import { importRequest } from '../../transport';

const ENDPOINT = '/pl/api/users';

/**
 * `group_name` accepts two shapes at once: a bare name, and a
 * `[name, "YYYY-MM-DD HH:MM:SS"]` pair that backdates the membership. Rows
 * without a date use the short form, because the long one with an empty second
 * element is rejected.
 */
export function buildGroupNames(
	this: IExecuteFunctions,
	itemIndex: number,
): Array<string | [string, string]> {
	const collection = this.getNodeParameter('groupsUi', itemIndex, {}) as IDataObject;
	const rows = (collection.entry ?? []) as IDataObject[];
	const timezone = this.getTimezone();

	const groups: Array<string | [string, string]> = [];

	for (const row of rows) {
		const name = String(row.name ?? '').trim();
		if (name === '') continue;

		const addedAt = toGetCourseDateTime(row.addedAt, timezone);
		groups.push(addedAt === undefined ? name : [name, addedAt]);
	}

	return groups;
}

/** `addfields` is a flat object keyed by the field's name as the account spells it. */
export function buildAddFields(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const collection = this.getNodeParameter('addFieldsUi', itemIndex, {}) as IDataObject;
	const rows = (collection.field ?? []) as IDataObject[];
	const fields: IDataObject = {};

	for (const row of rows) {
		const name = String(row.name ?? '').trim();
		if (name === '') continue;
		fields[name] = row.value ?? '';
	}

	return fields;
}

/** The `session` block, with the keys the user left blank removed. */
export function buildSession(this: IExecuteFunctions, itemIndex: number): IDataObject {
	return omitEmpty(this.getNodeParameter('session', itemIndex, {}) as IDataObject);
}

async function importUser(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const fields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;

	const email = String(this.getNodeParameter('email', itemIndex, '') ?? '').trim();
	const phone = String(this.getNodeParameter('phone', itemIndex, '') ?? '').trim();

	// GetCourse answers this case with "Не указан ни эл. адрес, ни телефон" wrapped
	// in a success envelope, which reads like the import worked. Better to say so
	// before spending one of the account's monthly object allowances on it.
	if (email === '' && phone === '') {
		throw new NodeOperationError(
			this.getNode(),
			'A user import needs an e-mail or a phone number',
			{
				description: 'GetCourse identifies people by e-mail; the phone number is the fallback.',
				itemIndex,
			},
		);
	}

	const user: IDataObject = omitEmpty({
		email,
		phone,
		first_name: fields.first_name,
		last_name: fields.last_name,
		city: fields.city,
		country: fields.country,
	});

	const groups = buildGroupNames.call(this, itemIndex);
	if (groups.length > 0) user.group_name = groups;

	const addfields = buildAddFields.call(this, itemIndex);
	if (Object.keys(addfields).length > 0) user.addfields = addfields;

	const system: IDataObject = omitEmpty({
		refresh_if_exists: fields.refresh_if_exists === true ? 1 : 0,
		partner_email: fields.partner_email,
	});

	const session = buildSession.call(this, itemIndex);

	const params: IDataObject = { user, system };
	if (Object.keys(session).length > 0) params.session = session;

	const envelope = await importRequest.call(this, ENDPOINT, 'add', params);

	const failure = importResultError(this.getNode(), envelope);
	if (failure !== undefined) throw failure;

	return [{ json: (envelope.result ?? {}) as IDataObject }];
}

async function replaceGroups(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const userId = String(this.getNodeParameter('userId', itemIndex, '') ?? '').trim();

	if (userId === '') {
		throw new NodeOperationError(this.getNode(), 'No user to change groups for', {
			description: 'Give the numeric GetCourse user ID. This operation does not accept an e-mail.',
			itemIndex,
		});
	}

	// Only the bare names are sent: the dated form belongs to the import action and
	// is ignored here, which is why the date picker is not offered on this operation.
	const groups = buildGroupNames
		.call(this, itemIndex)
		.map((group) => (Array.isArray(group) ? group[0] : group));

	const supplied = ((this.getNodeParameter('groupsUi', itemIndex, {}) as IDataObject).entry ??
		[]) as IDataObject[];

	// Rows were added and none of them names a group. Left alone that sends an
	// empty list, and an empty list here means "remove this person from every
	// group they belong to" — a destructive act nobody asked for, arrived at by an
	// expression that resolved to nothing.
	if (supplied.length > 0 && groups.length === 0) {
		throw new NodeOperationError(this.getNode(), 'None of the group rows names a group', {
			description:
				'Every row under Groups resolved to an empty name. Sending that as-is would remove the user from every group, so the request was not made. Fill the rows in, or delete them all and confirm the removal deliberately.',
			itemIndex,
		});
	}

	const envelope = await importRequest.call(this, ENDPOINT, 'update', {
		user: { id: userId, group_name: groups },
	});

	const failure = importResultError(this.getNode(), envelope);
	if (failure !== undefined) throw failure;

	return [
		{
			json: {
				...((envelope.result ?? {}) as IDataObject),
				user_id: userId,
				group_name: groups,
			},
		},
	];
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'import':
			return await importUser.call(this, itemIndex);
		case 'replaceGroups':
			return await replaceGroups.call(this, itemIndex);
		default:
			throw unknownOperation.call(this, 'user', operation, itemIndex);
	}
}
