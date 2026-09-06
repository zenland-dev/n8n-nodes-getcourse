import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';

import { unknownOperation } from '../../../../../utils/router';
import { fieldsRequest } from '../../transport';

/**
 * The custom-field dictionary, and the only place either GetCourse API publishes
 * one.
 *
 * The Tech API can read and write a user's custom fields but has no endpoint
 * listing what fields the account defines — its read side returns names without
 * IDs and its write side takes IDs. This call is where the two halves meet: it
 * returns `id`, `title`, `type` and `context_type` for every field on the
 * account, so a workflow that has to write through the Tech API can look the ID
 * up here first.
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getAll',
		displayOptions: { show: { resource: ['field'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many custom fields',
				description:
					'Справочник дополнительных полей пользователей и заказов. Returns every custom field the account defines, with its ID, title, type and the entity it belongs to.',
			},
		],
	},
	{
		displayName:
			'Это единственный способ узнать ID дополнительного поля. The legacy import addresses custom fields by title, while the Tech API addresses them by numeric ID and publishes no dictionary of its own — so this is where a Tech API workflow finds the ID it needs.',
		name: 'fieldNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: ['field'], operation: ['getAll'] } },
	},
	{
		displayName: 'Entity',
		name: 'contextFilter',
		type: 'string',
		default: '',
		placeholder: 'user',
		displayOptions: { show: { resource: ['field'], operation: ['getAll'] } },
		description:
			'Оставить только поля этой сущности, matched against context_type as a case-insensitive substring. Leave empty to see every field, which is also how you find out what values your account uses.',
	},
];

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation !== 'getAll') throw unknownOperation.call(this, 'field', operation, itemIndex);

	const envelope = await fieldsRequest.call(this);
	const info = envelope.info;
	const rows = Array.isArray(info) ? (info as IDataObject[]) : [];

	const wanted = String(this.getNodeParameter('contextFilter', itemIndex, '') ?? '')
		.trim()
		.toLowerCase();

	const filtered =
		wanted === ''
			? rows
			: rows.filter((row) =>
					String(row.context_type ?? '')
						.toLowerCase()
						.includes(wanted),
				);

	return filtered.map((row) => ({ json: row }));
}
