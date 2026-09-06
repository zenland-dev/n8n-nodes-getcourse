import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';

import { unknownOperation } from '../../../../../utils/router';
import { exportRequest } from '../../transport';

const ENDPOINT = '/pl/api/account/groups';

/**
 * The one read in the Export API that is not an export job.
 *
 * Every other `/pl/api/account/` endpoint returns an export ID and makes the
 * caller come back for the data; this one answers with the list itself. It still
 * spends a request from the account's two-hour budget, which is why the node
 * memoises it for the dropdowns.
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getAll',
		displayOptions: { show: { resource: ['group'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many groups',
				description:
					'Список всех групп аккаунта. Answers immediately with every group, its ID and when someone was last added to it — no export job involved.',
			},
		],
	},
	{
		displayName:
			'Ответ приходит сразу, без ключа экспорта, но один запрос из бюджета Export API он всё равно тратит. To export the people in a group rather than the list of groups, use the Export resource with the Group Members dataset.',
		name: 'groupNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: ['group'], operation: ['getAll'] } },
	},
];

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation !== 'getAll') throw unknownOperation.call(this, 'group', operation, itemIndex);

	const envelope = await exportRequest.call(this, ENDPOINT);
	const info = envelope.info;

	// Documented as a list of {id, name, last_added_at}; a single object would
	// still be a legitimate answer for an account with one group.
	if (Array.isArray(info)) return (info as IDataObject[]).map((group) => ({ json: group }));

	return info === null || typeof info !== 'object' ? [] : [{ json: info as IDataObject }];
}
