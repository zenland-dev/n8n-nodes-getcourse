import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';

import { isGetCourseDate, toGetCourseDate } from '../../../../../utils/dates';
import { omitEmpty, splitList } from '../../../../../utils/query';
import { unknownOperation } from '../../../../../utils/router';
import type { LegacyEnvelope } from '../../helpers/errors';
import { errorTextOf, isExportPending } from '../../helpers/errors';
import { readTable, tableToRows } from '../../helpers/exportRows';
import { exportRequest } from '../../transport';

const RESULT_ENDPOINT = '/pl/api/account/exports';

/** Where each dataset's job is started, and what a row of it is called. */
const DATASETS: Record<string, { endpoint: string; label: string }> = {
	users: { endpoint: '/pl/api/account/users', label: 'users' },
	deals: { endpoint: '/pl/api/account/deals', label: 'orders' },
	payments: { endpoint: '/pl/api/account/payments', label: 'payments' },
	groupUsers: { endpoint: '', label: 'group members' },
};

/**
 * `created_at[from]`-style pairs, dropped entirely when both ends are empty.
 *
 * Each bound is checked rather than trusted. The formatter passes text it cannot
 * read straight through, which is right for a write — GetCourse validates and
 * says what is wrong — but wrong here: nothing establishes that the export
 * rejects an unreadable filter rather than ignoring it, and an ignored
 * `created_at` turns "orders from March" into the whole account's history,
 * against a budget of a hundred requests every two hours.
 */
function range(
	this: IExecuteFunctions,
	label: string,
	from: unknown,
	to: unknown,
	timezone: string,
	itemIndex: number,
): IDataObject | undefined {
	const bounds = omitEmpty({
		from: assertDate.call(this, `${label} from`, from, timezone, itemIndex),
		to: assertDate.call(this, `${label} to`, to, timezone, itemIndex),
	});

	return Object.keys(bounds).length === 0 ? undefined : bounds;
}

function assertDate(
	this: IExecuteFunctions,
	label: string,
	value: unknown,
	timezone: string,
	itemIndex: number,
): string | undefined {
	const formatted = toGetCourseDate(value, timezone);
	if (formatted === undefined || isGetCourseDate(formatted)) return formatted;

	throw new NodeOperationError(this.getNode(), `"${label}" is not a date GetCourse can read`, {
		description:
			`The filter received ${JSON.stringify(String(value))}, which does not resolve to a day. ` +
			'Give it as YYYY-MM-DD, or as a date the workflow already holds — an unreadable filter ' +
			'would be sent as written, and an export that ignores its filter returns the whole account.',
		itemIndex,
	});
}

function startEndpoint(this: IExecuteFunctions, dataset: string, itemIndex: number): string {
	if (dataset !== 'groupUsers') return DATASETS[dataset].endpoint;

	const groupId = String(this.getNodeParameter('groupId', itemIndex, '') ?? '').trim();

	if (groupId === '') {
		throw new NodeOperationError(this.getNode(), 'No group to export members of', {
			description: 'Pick a group, or give its ID.',
			itemIndex,
		});
	}

	return `/pl/api/account/groups/${encodeURIComponent(groupId)}/users`;
}

/** Which collection holds the filters for each dataset. */
const FILTER_PARAMETERS: Record<string, string> = {
	users: 'userFilters',
	groupUsers: 'groupUserFilters',
	deals: 'dealFilters',
	payments: 'paymentFilters',
};

/**
 * Turns the chosen dataset's collection into the query GetCourse expects.
 *
 * Each dataset reads its own parameter, so a filter set for one can never
 * travel with another — see the note above the collections themselves.
 */
function buildFilters(this: IExecuteFunctions, dataset: string, itemIndex: number): IDataObject {
	const parameter = FILTER_PARAMETERS[dataset] ?? 'userFilters';
	const filters = this.getNodeParameter(parameter, itemIndex, {}) as IDataObject;
	const timezone = this.getTimezone();

	const query: IDataObject = omitEmpty({
		created_at: range.call(
			this,
			'Created',
			filters.createdFrom,
			filters.createdTo,
			timezone,
			itemIndex,
		),
		status: filters.status,
	});

	if (dataset === 'users') {
		const emails = splitList(filters.email);
		if (emails.length > 0) query.email = emails.join(',');
	}

	if (dataset === 'groupUsers') {
		const added = range.call(
			this,
			'Added to Group',
			filters.addedFrom,
			filters.addedTo,
			timezone,
			itemIndex,
		);
		if (added !== undefined) query.added_at = added;
	}

	if (dataset === 'deals') {
		const payed = range.call(this, 'Paid', filters.payedFrom, filters.payedTo, timezone, itemIndex);
		if (payed !== undefined) query.payed_at = payed;

		const finished = range.call(
			this,
			'Finished',
			filters.finishedFrom,
			filters.finishedTo,
			timezone,
			itemIndex,
		);
		if (finished !== undefined) query.finished_at = finished;

		const changed = range.call(
			this,
			'Status Changed',
			filters.statusChangedFrom,
			filters.statusChangedTo,
			timezone,
			itemIndex,
		);
		if (changed !== undefined) query.status_changed_at = changed;

		if (String(filters.user_in_group ?? '') !== '') query.user_in_group = filters.user_in_group;

		const userIds = splitList(filters.user_id);
		if (userIds.length > 0) query.user_id = userIds.join(',');
	}

	if (dataset === 'payments') {
		const changed = range.call(
			this,
			'Status Changed',
			filters.statusChangedFrom,
			filters.statusChangedTo,
			timezone,
			itemIndex,
		);
		if (changed !== undefined) query.status_changed_at = changed;
	}

	// Checked before the group columns are added: `idgrouplist` widens the result
	// rather than narrowing it, and GetCourse's own help page is explicit that it
	// does not satisfy the at-least-one-filter rule.
	assertFiltered.call(this, query, itemIndex);

	if (dataset === 'users') {
		const groupColumns = String(this.getNodeParameter('idgrouplist', itemIndex, '') ?? '');
		if (groupColumns !== '') query.idgrouplist = groupColumns;
	}

	return query;
}

/**
 * Refuses a filterless export.
 *
 * GetCourse answers one with «Должен быть передан хотя бы один фильтр», and an
 * account-wide export would in any case be the most expensive request the node
 * can make — for a school with years of history it is tens of megabytes and the
 * best part of the two-hour budget.
 */
function assertFiltered(this: IExecuteFunctions, query: IDataObject, itemIndex: number): void {
	if (Object.keys(query).length > 0) return;

	throw new NodeOperationError(this.getNode(), 'An export needs at least one filter', {
		description:
			'GetCourse refuses to build a file without one. A created-from date is the usual choice; adding a created-to date as well keeps the response to a size n8n can hold in memory.',
		itemIndex,
	});
}

/** Pulls the export ID out of the answer to a start request. */
function readExportId(
	this: IExecuteFunctions,
	envelope: LegacyEnvelope,
	itemIndex: number,
): string {
	const info = (envelope.info ?? {}) as IDataObject;
	const exportId = String(info.export_id ?? '').trim();

	if (exportId !== '') return exportId;

	// Not the "another export is already running" case, whatever it looks like:
	// that answers success:false with error_code 905 and is thrown by the
	// transport long before this runs, with the explanation describeCode gives it.
	// What reaches here is a success envelope that simply has no export_id in it.
	throw new NodeOperationError(this.getNode(), 'GetCourse started no export', {
		description:
			errorTextOf(envelope) ||
			'GetCourse accepted the request but the answer carried no export ID, so there is nothing to collect. Try the same filter again; if it keeps happening, run the export once from the account itself to check the dataset is available on this plan.',
		itemIndex,
	});
}

async function fetchResult(this: IExecuteFunctions, exportId: string): Promise<LegacyEnvelope> {
	return await exportRequest.call(
		this,
		`${RESULT_ENDPOINT}/${encodeURIComponent(exportId)}`,
		{},
		{ allowPending: true },
	);
}

/** Turns a ready result into output items, honouring the output options. */
function presentResult(
	this: IExecuteFunctions,
	envelope: LegacyEnvelope,
	exportId: string,
	itemIndex: number,
): INodeExecutionData[] {
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const table = readTable(envelope.info);

	if (options.output === 'raw') {
		return [
			{ json: { export_id: exportId, ready: true, ...((envelope.info ?? {}) as IDataObject) } },
		];
	}

	// An export whose filter matches nothing does NOT come back without a table:
	// a live account answers success with the full column header and `items: []`,
	// which `readTable` reads as a table of no rows and this function turns into
	// no output items — the right answer, reached the ordinary way. So this guard
	// is not that case. It is left in because it costs nothing and covers a shape
	// nobody has seen: a ready body carrying neither `fields` nor `items`.
	if (table === undefined) return [];

	return tableToRows(table, String(options.keyStyle ?? 'original')).map((row) => ({ json: row }));
}

async function start(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const dataset = String(this.getNodeParameter('dataset', itemIndex, 'users'));
	const envelope = await exportRequest.call(
		this,
		startEndpoint.call(this, dataset, itemIndex),
		buildFilters.call(this, dataset, itemIndex),
	);

	return [
		{
			json: {
				export_id: readExportId.call(this, envelope, itemIndex),
				dataset,
				ready: false,
			},
		},
	];
}

async function checkStatus(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const exportId = String(this.getNodeParameter('exportId', itemIndex, '') ?? '').trim();

	if (exportId === '') {
		throw new NodeOperationError(this.getNode(), 'No export to check', {
			description: 'Give the export ID that Start returned.',
			itemIndex,
		});
	}

	const envelope = await fetchResult.call(this, exportId);

	if (isExportPending(envelope)) {
		return [{ json: { export_id: exportId, ready: false, message: errorTextOf(envelope) } }];
	}

	const table = readTable(envelope.info);

	// The rows are deliberately dropped: this operation reports readiness, and
	// carrying a multi-megabyte table through an IF loop only to discard it is
	// what makes such loops fall over.
	return [
		{
			json: {
				export_id: exportId,
				ready: true,
				row_count: table?.items.length ?? 0,
				fields: table?.fields ?? [],
			},
		},
	];
}

async function getResult(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const exportId = String(this.getNodeParameter('exportId', itemIndex, '') ?? '').trim();

	if (exportId === '') {
		throw new NodeOperationError(this.getNode(), 'No export to fetch', {
			description: 'Give the export ID that Start returned.',
			itemIndex,
		});
	}

	const envelope = await fetchResult.call(this, exportId);

	if (isExportPending(envelope)) {
		if (this.getNodeParameter('onNotReady', itemIndex, 'error') === 'status') {
			return [{ json: { export_id: exportId, ready: false, message: errorTextOf(envelope) } }];
		}

		throw new NodeOperationError(this.getNode(), 'The export is still being built', {
			description:
				`GetCourse has not finished export ${exportId} yet. Put a Wait node in front of this one, ` +
				'or set "On Not Ready" to Return Status and loop back through an IF node.',
			itemIndex,
		});
	}

	return presentResult.call(this, envelope, exportId, itemIndex);
}

/**
 * Start, wait, fetch — the whole job in one node.
 *
 * The waiting happens inside the execution, which is simple to build but holds
 * the workflow open; a long export is better served by the three-operation
 * chain with an n8n Wait node, which survives a restart of the instance.
 */
async function run(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const polling = this.getNodeParameter('polling', itemIndex, {}) as IDataObject;
	const initialDelay = Number(polling.initialDelay ?? 15);
	const pollInterval = Math.max(5, Number(polling.pollInterval ?? 30));
	const maxPolls = Math.max(1, Number(polling.maxPolls ?? 10));

	const dataset = String(this.getNodeParameter('dataset', itemIndex, 'users'));
	const started = await exportRequest.call(
		this,
		startEndpoint.call(this, dataset, itemIndex),
		buildFilters.call(this, dataset, itemIndex),
	);
	const exportId = readExportId.call(this, started, itemIndex);

	if (initialDelay > 0) await sleep(initialDelay * 1000);

	for (let poll = 1; poll <= maxPolls; poll++) {
		let envelope: LegacyEnvelope;

		try {
			envelope = await fetchResult.call(this, exportId);
		} catch (error) {
			// The job is already running on GetCourse's side and has already cost the
			// account a slot from its two-hour budget. Failing without naming the export
			// ID would strand it: there is no way to list exports, so an ID nobody
			// recorded can never be collected. This is not hypothetical — running out of
			// budget part-way through the poll loop is exactly how it happens.
			throw new NodeOperationError(
				this.getNode(),
				`Export ${exportId} was started but could not be collected: ${
					error instanceof Error ? error.message : String(error)
				}`,
				{
					description:
						`GetCourse is still building export ${exportId}, and it is not lost — a Get Result ` +
						'with that ID will pick it up once the file is ready and the request budget allows. ' +
						'Set "On Timeout" to return the ID if you would rather the workflow carried on.',
					itemIndex,
				},
			);
		}

		if (!isExportPending(envelope)) return presentResult.call(this, envelope, exportId, itemIndex);

		if (poll < maxPolls) await sleep(pollInterval * 1000);
	}

	if (polling.onTimeout === 'returnId') {
		return [{ json: { export_id: exportId, dataset, ready: false } }];
	}

	throw new NodeOperationError(this.getNode(), 'The export did not finish in time', {
		description:
			`GetCourse is still building export ${exportId} after ${maxPolls} checks. It is not lost — ` +
			'a Get Result with that ID will pick it up once it is done. Raise "Give Up After", or set ' +
			'"On Timeout" to return the ID and fetch it in a later run.',
		itemIndex,
	});
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'run':
			return await run.call(this, itemIndex);
		case 'start':
			return await start.call(this, itemIndex);
		case 'checkStatus':
			return await checkStatus.call(this, itemIndex);
		case 'getResult':
			return await getResult.call(this, itemIndex);
		default:
			throw unknownOperation.call(this, 'export', operation, itemIndex);
	}
}
