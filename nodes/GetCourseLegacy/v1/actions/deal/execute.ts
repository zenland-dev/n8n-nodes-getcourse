import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { toGetCourseDateTime } from '../../../../../utils/dates';
import { omitEmpty } from '../../../../../utils/query';
import { unknownOperation } from '../../../../../utils/router';
import { importResultError } from '../../helpers/errors';
import { importRequest } from '../../transport';
import { buildAddFields, buildGroupNames, buildSession } from '../user/execute';

const ENDPOINT = '/pl/api/deals';

/** The buyer block. An order import always carries one, even when it only matches. */
function buildUser(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const fields = this.getNodeParameter('userFields', itemIndex, {}) as IDataObject;

	const user: IDataObject = omitEmpty({
		email: String(this.getNodeParameter('email', itemIndex, '') ?? '').trim(),
		phone: String(this.getNodeParameter('phone', itemIndex, '') ?? '').trim(),
		first_name: fields.first_name,
		last_name: fields.last_name,
		city: fields.city,
		country: fields.country,
	});

	const groups = buildGroupNames.call(this, itemIndex);
	if (groups.length > 0) user.group_name = groups;

	return user;
}

/**
 * Refuses an import GetCourse would accept and then quietly do nothing useful with.
 *
 * The platform's minimum is an e-mail plus either an offer ID, or an offer code
 * or product title together with an amount. Short of that it answers with a
 * success envelope carrying an error inside, and the workflow carries on as if
 * an order had been created.
 */
function assertMinimumFields(this: IExecuteFunctions, itemIndex: number, deal: IDataObject): void {
	if (String(deal.email ?? '') === '' && String(deal.phone ?? '') === '') {
		throw new NodeOperationError(this.getNode(), 'An order import needs the buyer e-mail', {
			description:
				'GetCourse attaches the order to a person, and identifies that person by e-mail.',
			itemIndex,
		});
	}

	if (String(deal.offer_id ?? '') !== '') return;

	const named = String(deal.offer_code ?? '') !== '' || String(deal.product_title ?? '') !== '';
	const priced = Number(deal.deal_cost ?? 0) > 0;

	if (named && priced) return;

	throw new NodeOperationError(this.getNode(), 'An order import needs an offer and a price', {
		description:
			'Give an Offer ID, or an Offer Code (or Product Title) together with an Amount above zero. Those are the two combinations GetCourse accepts.',
		itemIndex,
	});
}

async function importDeal(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const fields = this.getNodeParameter('dealFields', itemIndex, {}) as IDataObject;
	const userFields = this.getNodeParameter('userFields', itemIndex, {}) as IDataObject;
	const timezone = this.getTimezone();

	const deal: IDataObject = omitEmpty({
		deal_number: fields.deal_number,
		offer_id: String(this.getNodeParameter('offer_id', itemIndex, '') ?? '').trim(),
		offer_code: String(this.getNodeParameter('offer_code', itemIndex, '') ?? '').trim(),
		product_title: fields.product_title,
		product_description: fields.product_description,
		quantity: fields.quantity,
		deal_cost: Number(this.getNodeParameter('deal_cost', itemIndex, 0)) || undefined,
		deal_status: fields.deal_status,
		manager_email: fields.manager_email,
		deal_created_at: toGetCourseDateTime(fields.deal_created_at, timezone),
		deal_finished_at: toGetCourseDateTime(fields.deal_finished_at, timezone),
		deal_comment: fields.deal_comment,
		payment_type: fields.payment_type,
		payment_status: fields.payment_status,
		partner_email: fields.partner_email,
		deal_currency: fields.deal_currency,
		funnel_id: fields.funnel_id,
		funnel_stage_id: fields.funnel_stage_id,
	});

	// Sent as 1/0 rather than left out, because the field's absence and its being
	// false mean the same thing to GetCourse but not to someone reading the request.
	if (fields.deal_is_paid !== undefined) deal.deal_is_paid = fields.deal_is_paid === true ? 1 : 0;

	const addfields = buildAddFields.call(this, itemIndex);
	if (Object.keys(addfields).length > 0) deal.addfields = addfields;

	const user = buildUser.call(this, itemIndex);

	assertMinimumFields.call(this, itemIndex, {
		email: user.email,
		phone: user.phone,
		offer_id: deal.offer_id,
		offer_code: deal.offer_code,
		product_title: deal.product_title,
		deal_cost: deal.deal_cost,
	});

	const system: IDataObject = {
		refresh_if_exists: userFields.refresh_if_exists === true ? 1 : 0,
		multiple_offers: fields.multiple_offers === true ? 1 : 0,
		return_payment_link: fields.return_payment_link === true ? 1 : 0,
		return_deal_number: fields.return_deal_number === false ? 0 : 1,
	};

	if (String(userFields.partner_email ?? '') !== '') {
		system.partner_email = userFields.partner_email;
	}

	const session = buildSession.call(this, itemIndex);

	const params: IDataObject = { user, system, deal };
	if (Object.keys(session).length > 0) params.session = session;

	const envelope = await importRequest.call(this, ENDPOINT, 'add', params);

	const failure = importResultError(this.getNode(), envelope);
	if (failure !== undefined) throw failure;

	return [{ json: (envelope.result ?? {}) as IDataObject }];
}

async function setStatus(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const email = String(this.getNodeParameter('email', itemIndex, '') ?? '').trim();
	const phone = String(this.getNodeParameter('phone', itemIndex, '') ?? '').trim();
	const dealNumber = String(this.getNodeParameter('deal_number', itemIndex, '') ?? '').trim();
	const status = String(this.getNodeParameter('deal_status', itemIndex, '') ?? '').trim();

	if (dealNumber === '') {
		throw new NodeOperationError(this.getNode(), 'No order to change', {
			description: 'Give the order number. Without it GetCourse creates a new order instead.',
			itemIndex,
		});
	}

	if (email === '' && phone === '') {
		throw new NodeOperationError(this.getNode(), 'A status change needs the buyer e-mail', {
			description: 'The legacy API identifies the order by its number together with its owner.',
			itemIndex,
		});
	}

	const envelope = await importRequest.call(this, ENDPOINT, 'add', {
		user: omitEmpty({ email, phone }),
		deal: { deal_number: dealNumber, deal_status: status },
	});

	const failure = importResultError(this.getNode(), envelope);
	if (failure !== undefined) throw failure;

	return [
		{
			json: {
				...((envelope.result ?? {}) as IDataObject),
				deal_number: dealNumber,
				deal_status: status,
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
			return await importDeal.call(this, itemIndex);
		case 'setStatus':
			return await setStatus.call(this, itemIndex);
		default:
			throw unknownOperation.call(this, 'order', operation, itemIndex);
	}
}
