import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { returnAllProperties } from '../../descriptions/common';
import { toItems } from '../../helpers/request';
import { unknownOperation } from '../../../../../utils/router';
import { techApiRequest, techApiRequestAllItems } from '../../transport';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['offer'], operation: operations },
});

/** The two listings take the same pair of parameters and nothing else. */
const LISTS = ['getMany', 'getManyTags'];

/**
 * Предложения — what an order is actually for.
 *
 * Read-only, and not by omission: the Tech API has no way to create, price or
 * retire an offer, so all three operations are GETs. What they are for is the
 * join a workflow keeps needing — an order names an offer, an offer names its
 * products and its training, and nothing else in the API connects the two.
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getMany',
		displayOptions: { show: { resource: ['offer'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get an offer',
				description: 'Информация по предложению — цена, НДС, продукты и теги',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many offers',
				description:
					'Информация по всем предложениям. The endpoint pages with limit and offset and reports no total, so Return All walks it until a short page comes back.',
			},
			{
				name: 'Get Many Tags',
				value: 'getManyTags',
				action: 'Get many offer tags',
				description:
					'Список предложений и их тегов. One row per offer, holding the tag names and no IDs — far cheaper than reading every offer when the tags are all that matter.',
			},
		],
	},
	{
		displayName:
			'Предложение приходит целиком, частичного ответа у метода нет. Ставка НДС — vat: none, vat0, vat5, vat7, vat10, vat22; тип продукта — products[].type: groups, simple, training, tariff, cms_template, extend_limits, user_balance, virtual_balance, promo_code, chatium_course, hd_advert, ticket, ai_token, и вложенные training и stream заполнены только у продуктов типа training. Теги предложения — это объект вида {"1": "Программирование"}, а не массив, и это единственное место в API, где виден ID тега; params спецификация объявляет объектом, хотя в собственном примере он пустой массив, так что читать его надо с оглядкой на обе формы.',
		name: 'offerShapeNotice',
		type: 'notice',
		default: '',
		displayOptions: showFor(['get', 'getMany']),
	},
	{
		displayName: 'Offer Name or ID',
		name: 'offerId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getOffers' },
		default: '',
		required: true,
		displayOptions: showFor(['get']),
		description:
			'Предложение, о котором нужны данные. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	...returnAllProperties(showFor(LISTS)),
];

/** `GET /offer/get-offer-by-id` — one offer, which the API still wraps in an array. */
async function getOffer(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const offerId = String(this.getNodeParameter('offerId', itemIndex, '') ?? '').trim();

	if (offerId === '') {
		throw new NodeOperationError(this.getNode(), 'No offer named', {
			description: 'Pick an offer from the list, or give its numeric ID.',
			itemIndex,
		});
	}

	const data = (await techApiRequest.call(this, 'GET', '/offer/get-offer-by-id', undefined, {
		offerId: Number(offerId),
	})) as unknown;

	// The response is an array even though the request names a single offer, so the
	// one record arrives as data[0]. An unknown ID is a documented 404 rather than an
	// empty array — if an empty one does arrive, no items is the honest answer to it.
	const rows = Array.isArray(data) ? (data as IDataObject[]) : toItems(data, {});

	return rows.map((row) => ({ json: row }));
}

const LIST_ENDPOINTS: Record<string, string> = {
	getMany: '/offer/get-offers',
	getManyTags: '/offer/get-offers-tags',
};

/**
 * The two listings, walked page by page.
 *
 * Both take `limit` and `offset` and document no ceiling on either, so the page
 * size is ours to pick; 100 keeps one response small enough to be worth retrying.
 * Neither reports a total, so the only end-of-list signal is a page that comes
 * back shorter than asked for — which is what `techApiRequestAllItems` watches for.
 */
async function getOfferList(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = this.getNodeParameter('limit', itemIndex, 50) as number;

	const rows = await techApiRequestAllItems.call(
		this,
		LIST_ENDPOINTS[operation],
		{},
		{ pageSize: 100, ...(returnAll ? {} : { limit: Math.max(1, limit) }) },
	);

	return rows.map((row) => ({ json: row }));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'get':
			return await getOffer.call(this, itemIndex);
		case 'getMany':
		case 'getManyTags':
			return await getOfferList.call(this, operation, itemIndex);
		default:
			throw unknownOperation.call(this, 'offer', operation, itemIndex);
	}
}
