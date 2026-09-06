import type { INodeProperties } from 'n8n-workflow';

import {
	addFieldsProperty,
	groupsProperty,
	importNotice,
	sessionProperty,
	userIdentityProperties,
	userProfileFields,
} from '../../descriptions/common';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['user'], operation: operations },
});

/**
 * There is no read here, and no delete.
 *
 * The legacy API writes users through `/pl/api/users` and reads them only in
 * bulk, through the Export resource. Single-user reads live on the Tech API,
 * which is what the GetCourse node covers.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'import',
	displayOptions: { show: { resource: ['user'] } },
	options: [
		{
			name: 'Import',
			value: 'import',
			action: 'Import a user',
			description:
				'Создать или обновить пользователя. Adds the person if the e-mail is new, and updates them if it is not — but only when Update Existing is on.',
		},
		{
			name: 'Replace Groups',
			value: 'replaceGroups',
			action: 'Replace the groups of a user',
			description:
				'Задать список групп пользователя. Leaves the person in exactly the groups listed and removes them from every other one.',
		},
	],
};

const importFields: INodeProperties = {
	displayName: 'Additional Fields',
	name: 'additionalFields',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	displayOptions: showFor(['import']),
	options: [
		...userProfileFields(),
		{
			displayName: 'Partner Email',
			name: 'partner_email',
			type: 'string',
			placeholder: 'partner@example.com',
			default: '',
			description:
				"Email партнёра. Marks the person as this partner's referral. A partner who does not exist is an error; one who exists but is not yet a partner is promoted to one.",
		},
		{
			displayName: 'Update Existing',
			name: 'refresh_if_exists',
			type: 'boolean',
			default: false,
			description:
				"Whether to overwrite an existing person's data (обновлять существующего). With this off, an import for a known e-mail changes nothing at all — not even the groups.",
		},
	],
};

const replaceGroupsNotice: INodeProperties = {
	displayName:
		'Каждая группа, которой нет в списке ниже, будет снята. This operation sets the whole membership list, so a user in five groups and a request naming one ends up in that one group only. To add a group without touching the others, use Import instead.',
	name: 'replaceGroupsNotice',
	type: 'notice',
	default: '',
	displayOptions: showFor(['replaceGroups']),
};

const userIdProperty: INodeProperties = {
	displayName: 'User ID',
	name: 'userId',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['replaceGroups']),
	description:
		'ID пользователя в GetCourse. This operation is the one place the legacy API insists on the numeric ID rather than an e-mail; the Export resource and the GetCourse node both return it.',
};

export const description: INodeProperties[] = [
	operation,
	importNotice('userImportNotice', showFor(['import'])),
	replaceGroupsNotice,
	...userIdentityProperties(showFor(['import'])),
	userIdProperty,
	groupsProperty(showFor(['import'])),
	groupsProperty(showFor(['replaceGroups']), {
		includeAddedAt: false,
		description:
			'Группы, в которых пользователь останется. Named by title. Every group not listed here is removed, and this operation ignores join dates, so the date picker is not offered.',
	}),
	importFields,
	addFieldsProperty(showFor(['import']), 'getUserCustomFields', 'пользователя'),
	sessionProperty(showFor(['import'])),
];
