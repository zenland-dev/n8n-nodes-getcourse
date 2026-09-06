import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { splitList } from '../../../../../utils/query';
import { unknownOperation } from '../../../../../utils/router';
import { customFieldsPayload, dealId, toItems } from '../../helpers/request';
import { techApiRequest, techApiRequestAllItems } from '../../transport';

/** The reads that differ in nothing but their path. */
const READS: Record<string, string> = {
	get: '/deal/get-fields',
	getCalls: '/deal/get-calls',
	getComments: '/deal/get-comments',
	getCustomFields: '/deal/get-custom-fields',
};

/**
 * What a read's `data` becomes.
 *
 * An order with no comments answers `[]`, and that is a true answer — unlike a
 * write, where the same empty array means "done" and has to be turned into
 * something visible. So an empty list stays empty here, while `/deal/get-fields`
 * (a bare object, not an array) is wrapped into the single item it is.
 */
function readRows(data: unknown): IDataObject[] {
	return Array.isArray(data) ? (data as IDataObject[]) : toItems(data, {});
}

/**
 * `GET /deal/get-deals-tags` — limit and offset, no total, no ceiling.
 *
 * The spec gives the two query parameters no defaults and documents no maximum,
 * so the page size is the node's own choice. 100 keeps a Return All over a large
 * account to a sane number of requests without courting a silent server-side
 * clamp, which would be indistinguishable from the end of the list.
 */
async function getManyTags(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = this.getNodeParameter('limit', itemIndex, 50) as number;

	const rows = await techApiRequestAllItems.call(
		this,
		'/deal/get-deals-tags',
		{},
		{ limit: returnAll ? undefined : Math.max(1, limit), pageSize: 100 },
	);

	return rows.map((row) => ({ json: row }));
}

/** `POST /deal/update-fields` — the manager, the status, the cancellation, the tags. */
async function updateDeal(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const id = dealId.call(this, itemIndex);
	const fields = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;

	const body: IDataObject = { dealId: id };

	const managerId = String(fields.manager_user_id ?? '').trim();
	if (managerId !== '') body.manager_user_id = Number(managerId);

	// `false` here is GetCourse's «Ложный» status — a member of the string enum,
	// not a boolean, and `String()` keeps it that way whatever the editor stored.
	const status = String(fields.status ?? '').trim();
	if (status !== '') body.status = status;

	// The documented body has no `cancel_reason_id`, even though the `status`
	// field's own description tells the caller to send one with a cancellation,
	// `Deal.cancel_reason_id` exists on the read side, and an endpoint exists for
	// the sole purpose of listing the reasons. Sending it is the cheap bet: a
	// server that ignores unknown keys is no worse off, and one that reads it
	// gives the order the reason the user picked.
	const reasonId = String(fields.cancel_reason_id ?? '').trim();
	if (reasonId !== '') body.cancel_reason_id = Number(reasonId);

	// Declared `integer` in the spec and described as «Описание причины отказа»,
	// while the read side answers with a string. The description wins.
	const reasonComment = String(fields.cancel_reason_comment ?? '');
	if (reasonComment !== '') body.cancel_reason_comment = reasonComment;

	const tags = splitList(fields.tags);
	if (tags.length > 0) body.tags = tags;

	if (Object.keys(body).length === 1) {
		throw new NodeOperationError(this.getNode(), 'Nothing to change on the order', {
			description: 'Add at least one entry under Update Fields.',
			itemIndex,
		});
	}

	const data = await techApiRequest.call(this, 'POST', '/deal/update-fields', body);

	// This one answers with the order, unlike the user updater's empty array —
	// though with the plain Deal fields only, without the tags Get adds on top.
	return toItems(data, { dealId: id, success: true }).map((row) => ({ json: row }));
}

/** `POST /deal/update-custom-fields` — values keyed by numeric field ID. */
async function updateCustomFields(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	// The spec leaves `dealId` out of the schema's `required` list, which is
	// plainly an oversight — there is no other way to say which order is meant.
	// The node insists on it, and `dealId()` refuses a blank one.
	const id = dealId.call(this, itemIndex);
	const customFields = customFieldsPayload.call(this, itemIndex);

	if (Object.keys(customFields).length === 0) {
		throw new NodeOperationError(this.getNode(), 'No custom fields to write', {
			description: 'Add at least one field ID and its value under Custom Fields.',
			itemIndex,
		});
	}

	const data = await techApiRequest.call(this, 'POST', '/deal/update-custom-fields', {
		dealId: id,
		customFields,
	});

	return toItems(data, { dealId: id, success: true }).map((row) => ({ json: row }));
}

/** `POST /deal/add-positions` — one offer, price and quantity per row. */
async function addPositions(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const id = dealId.call(this, itemIndex);
	const collection = this.getNodeParameter('positionsUi', itemIndex, {}) as IDataObject;
	const rows = (collection.position ?? []) as IDataObject[];

	const positions: IDataObject[] = [];

	for (const row of rows) {
		const offerId = String(row.offerId ?? '').trim();
		if (offerId === '') continue;

		const position: IDataObject = { offerId: Number(offerId) };

		// Both remaining keys are optional in the schema, and the platform's own
		// example omits the quantity on one of its two positions. An empty price
		// box is therefore an omission rather than a zero, which would turn the
		// line free without anybody asking for it.
		// Prices reach n8n written the way a person writes them — «1 990,00», with a
		// comma for the decimal point and sometimes a non-breaking space between the
		// thousands. `Number` reads any of those as NaN, and JSON turns NaN into
		// null, which GetCourse takes for "no price given" and charges the offer's
		// own instead. Normalising first is the difference between a wrong invoice
		// and an error.
		const price = String(row.price ?? '')
			.replace(/[\s\u00a0\u202f\u2007]/g, '')
			.replace(',', '.');

		if (price !== '') {
			const parsed = Number(price);

			if (!Number.isFinite(parsed)) {
				throw new NodeOperationError(this.getNode(), `"${String(row.price)}" is not a price`, {
					description:
						'Give the amount as a number. A value GetCourse cannot read is sent as null, and null on a position means the offer price is used instead.',
					itemIndex,
				});
			}

			position.price = parsed;
		}

		const quantity = Number(row.quantity ?? 0);
		if (Number.isFinite(quantity) && quantity > 0) position.quantity = quantity;

		positions.push(position);
	}

	if (positions.length === 0) {
		throw new NodeOperationError(this.getNode(), 'No positions to add', {
			description: 'Add at least one position and name the offer it stands for.',
			itemIndex,
		});
	}

	const data = await techApiRequest.call(this, 'POST', '/deal/add-positions', {
		dealId: id,
		positions,
	});

	// Success is an empty array here, so the fallback carries the only facts
	// worth passing on: which order was changed, and by how many lines.
	return toItems(data, { dealId: id, added: positions.length }).map((row) => ({ json: row }));
}

/** `POST /deal/remove-positions` — by position ID, not by offer ID. */
async function removePositions(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const id = dealId.call(this, itemIndex);

	const positionIds = splitList(this.getNodeParameter('positionIds', itemIndex, ''))
		.map((entry) => Number(entry))
		.filter((entry) => Number.isFinite(entry));

	if (positionIds.length === 0) {
		throw new NodeOperationError(this.getNode(), 'No positions to remove', {
			description:
				"List the numeric position IDs, comma-separated. Get returns them in the order's positions array.",
			itemIndex,
		});
	}

	const data = await techApiRequest.call(this, 'POST', '/deal/remove-positions', {
		dealId: id,
		positionIds,
	});

	return toItems(data, { dealId: id, removed: positionIds.length }).map((row) => ({ json: row }));
}

/** `POST /deal/add-comment` — appends to the order's activity log. */
async function addComment(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const id = dealId.call(this, itemIndex);
	const userId = String(this.getNodeParameter('authorId', itemIndex, '') ?? '').trim();
	const text = String(this.getNodeParameter('text', itemIndex, '') ?? '');

	if (userId === '') {
		throw new NodeOperationError(this.getNode(), 'No comment author named', {
			description:
				'Pick the person the comment is written on behalf of, or give their numeric user ID.',
			itemIndex,
		});
	}

	if (text.trim() === '') {
		throw new NodeOperationError(this.getNode(), 'The comment has no text', {
			description: 'Fill in what the comment should say.',
			itemIndex,
		});
	}

	const data = await techApiRequest.call(this, 'POST', '/deal/add-comment', {
		dealId: id,
		userId: Number(userId),
		text,
	});

	// The reply is `{ result: true }` and not the comment, so the order and the
	// author are put back alongside it — otherwise the item names neither.
	return toItems(data, { result: true }).map((row) => ({
		json: { dealId: id, userId: Number(userId), ...row },
	}));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	// The account-wide dictionary: no order, no parameters at all.
	if (operation === 'getCancelReasons') {
		const data = await techApiRequest.call(this, 'GET', '/deal/get-cancel-reasons');
		return readRows(data).map((row) => ({ json: row }));
	}

	const endpoint = READS[operation];
	if (endpoint !== undefined) {
		const data = await techApiRequest.call(this, 'GET', endpoint, undefined, {
			dealId: dealId.call(this, itemIndex),
		});

		return readRows(data).map((row) => ({ json: row }));
	}

	switch (operation) {
		case 'addComment':
			return await addComment.call(this, itemIndex);
		case 'addPositions':
			return await addPositions.call(this, itemIndex);
		case 'getManyTags':
			return await getManyTags.call(this, itemIndex);
		case 'removePositions':
			return await removePositions.call(this, itemIndex);
		case 'update':
			return await updateDeal.call(this, itemIndex);
		case 'updateCustomFields':
			return await updateCustomFields.call(this, itemIndex);
		default:
			throw unknownOperation.call(this, 'deal', operation, itemIndex);
	}
}
