import type { INodeProperties } from 'n8n-workflow';

import type { ResourceModule } from '../../../../utils/router';
import * as deal from './deal';
import * as exportJob from './export';
import * as field from './field';
import * as group from './group';
import * as user from './user';

/** Keyed by the `resource` value, which is part of every saved workflow. */
export const resources: Record<string, ResourceModule> = {
	deal,
	export: exportJob,
	field,
	group,
	user,
};

export const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	default: 'export',
	options: [
		{
			name: 'Custom Field',
			value: 'field',
			description:
				'Справочник дополнительных полей аккаунта — the only place either API publishes it',
		},
		{
			name: 'Export',
			value: 'export',
			description: 'Выгрузка пользователей, заказов, платежей и участников групп',
		},
		{
			name: 'Group',
			value: 'group',
			description: 'Список групп аккаунта',
		},
		{
			name: 'Order',
			value: 'deal',
			description: 'Импорт заказов и смена их статуса',
		},
		{
			name: 'User',
			value: 'user',
			description: 'Импорт пользователей и управление их группами',
		},
	],
};

export const resourceProperties: INodeProperties[] = Object.values(resources).flatMap(
	(module) => module.description,
);
