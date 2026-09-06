import type { INodeProperties } from 'n8n-workflow';

import {
	customFieldsProperty,
	dealIdProperty,
	returnAllProperties,
} from '../../descriptions/common';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['deal'], operation: operations },
});

/** Every operation that addresses one order, and so needs its ID. */
const NEEDS_ORDER = [
	'addComment',
	'addPositions',
	'get',
	'getCalls',
	'getComments',
	'getCustomFields',
	'removePositions',
	'update',
	'updateCustomFields',
];

/**
 * The order — read six ways, written five, created never.
 *
 * The Tech API cannot make an order and cannot delete one; that is the legacy
 * Import API's job. What it can do is inspect an order whose ID it is handed,
 * and change the handful of fields a sales workflow actually moves: the
 * manager, the status, the cancellation reason, the tags, the positions and the
 * comment thread.
 *
 * Finding the ID in the first place is the awkward part. There is no listing
 * endpoint for orders anywhere in the API — Get Many Tags is the closest thing,
 * and it answers with nothing but an ID and tag names. The usual sources are a
 * webhook, Get Deals on the User resource, or the order export in the GetCourse
 * Legacy node.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'get',
	displayOptions: { show: { resource: ['deal'] } },
	options: [
		{
			name: 'Add Comment',
			value: 'addComment',
			action: 'Add a comment to an order',
			description:
				"Добавить комментарий в заказ от имени выбранного пользователя. The comment is appended to the order's activity log; nothing already written there is touched.",
		},
		{
			name: 'Add Positions',
			value: 'addPositions',
			action: 'Add positions to an order',
			description:
				'Добавить позиции в заказ — one row per offer, each with its own price and quantity',
		},
		{
			name: 'Get',
			value: 'get',
			action: 'Get an order',
			description: 'Информация по заказу — every field of the order plus the tags hanging on it',
		},
		{
			name: 'Get Calls',
			value: 'getCalls',
			action: 'Get the calls of an order',
			description:
				'Звонки по заказу. Each record carries its transcription in a comment field, which is empty on an account that does not transcribe.',
		},
		{
			name: 'Get Cancel Reasons',
			value: 'getCancelReasons',
			action: 'Get many cancellation reasons',
			description:
				'Справочник причин отказа аккаунта. Takes no parameters, and supplies the IDs that Update sends with a cancellation.',
		},
		{
			name: 'Get Comments',
			value: 'getComments',
			action: 'Get the comments of an order',
			description: 'Комментарии заказа — the activity log GetCourse keeps against the order',
		},
		{
			name: 'Get Custom Fields',
			value: 'getCustomFields',
			action: 'Get the custom fields of an order',
			description:
				'Дополнительные поля заказа. The reply names each field but carries no field ID, and the ID is exactly what Update Custom Fields needs — the two ends do not join up.',
		},
		{
			name: 'Get Many Tags',
			value: 'getManyTags',
			action: 'Get many orders with their tags',
			description:
				'Список заказов и их тегов. The one endpoint in the Tech API that lists orders at all, and it answers with nothing but an ID and tag names.',
		},
		{
			name: 'Remove Positions',
			value: 'removePositions',
			action: 'Remove positions from an order',
			description:
				"Удалить позиции из заказа. Positions are named by their own IDs, which Get returns in the order's positions array — an offer ID will not do.",
		},
		{
			name: 'Update',
			value: 'update',
			action: 'Update an order',
			description:
				'Обновить поля заказа: менеджера, статус, причину отказа и теги. Unlike the user updater, this one answers with the order itself.',
		},
		{
			name: 'Update Custom Fields',
			value: 'updateCustomFields',
			action: 'Update the custom fields of an order',
			description:
				'Изменить дополнительные поля заказа, addressed by numeric field ID rather than by name',
		},
	],
};

const tagsPagingNotice: INodeProperties = {
	displayName:
		'У этого эндпоинта нет ни фильтров, ни счётчика — он отдаёт заказы аккаунта подряд. The node walks it 100 rows at a time and stops at the first short page, so Return All on a busy account is a long run of requests.',
	name: 'dealTagsPagingNotice',
	type: 'notice',
	default: '',
	displayOptions: showFor(['getManyTags']),
};

const cancelNotice: INodeProperties = {
	displayName:
		'Поля причины отказа появляются в списке, когда выбран статус Cancelled. GetCourse documents the reason as the companion of a cancellation, so an order that is already cancelled needs the status sent again alongside the reason.',
	name: 'dealCancelNotice',
	type: 'notice',
	default: '',
	displayOptions: showFor(['update']),
};

/**
 * What `POST /deal/update-fields` will take.
 *
 * Five fields out of the thirty-odd an order carries. Everything to do with
 * money — cost, currency, payments — is read-only here; the positions have
 * their own two operations, and a payment is the legacy Import API's business.
 */
const updateFields: INodeProperties = {
	displayName: 'Update Fields',
	name: 'updateFields',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	displayOptions: showFor(['update']),
	options: [
		{
			displayName: 'Cancellation Reason Comment',
			name: 'cancel_reason_comment',
			type: 'string',
			default: '',
			displayOptions: { show: { status: ['cancelled'] } },
			description:
				'Описание причины отказа, свободный текст. GetCourse declares this field an integer while describing it as a description, and the same field is a string when the order is read back, so the node sends text.',
		},
		{
			displayName: 'Cancellation Reason Name or ID',
			name: 'cancel_reason_id',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getCancelReasons' },
			default: '',
			displayOptions: { show: { status: ['cancelled'] } },
			description:
				'Причина отказа из справочника аккаунта. The documented request body omits this field, but a live account accepts it and stores it on the order, so sending it works. It is not validated against the account\'s own list of reasons: an ID that matches nothing is stored just as readily, and the order ends up cancelled for a reason nobody can read. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		},
		{
			displayName: 'Manager Name or ID',
			name: 'manager_user_id',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getManagers' },
			default: '',
			description:
				'Ответственный менеджер заказа. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		},
		{
			displayName: 'Status',
			name: 'status',
			type: 'options',
			default: 'new',
			options: [
				{
					name: 'Cancelled (Отменен)',
					value: 'cancelled',
					description: 'Отказ клиента — the status the two cancellation fields belong to',
				},
				{
					name: 'False (Ложный)',
					value: 'false',
					description:
						'Ложный заказ — the value travels as the string false and never as a boolean',
				},
				{ name: 'In Progress (В работе)', value: 'in_work' },
				{ name: 'New (Новый)', value: 'new' },
				{ name: 'Not Confirmed (Не подтвержден)', value: 'not_confirmed' },
				{ name: 'Paid (Оплачен)', value: 'payed' },
				{ name: 'Partly Paid (Частично оплачен)', value: 'part_payed' },
				{ name: 'Waiting for Payment (Ожидаем оплаты)', value: 'payment_waiting' },
				{ name: 'Waiting for Refund (Ожидаем возврата)', value: 'waiting_for_return' },
			],
			description:
				'Статус заказа. Moving an order to a paid status here changes the status and nothing else — it registers no payment, unlike the legacy order import.',
		},
		{
			displayName: 'Tags',
			name: 'tags',
			type: 'string',
			default: '',
			placeholder: 'VIP, повтор',
			description:
				"Теги заказа, comma-separated. This list REPLACES the order's tags rather than adding to them — tested on a live account, where setting one tag and then another left only the second — so include the tags you want to keep. GetCourse does clear the list when sent an empty one, but this field cannot do that: a blank value means «leave the tags alone», which is what an unfilled optional field has to mean.",
		},
	],
};

/**
 * The positions of an order, as the writer sees them.
 *
 * `price` is a text box rather than a number on purpose: both it and `quantity`
 * are optional in the schema — GetCourse's own example omits the quantity on
 * one of its two positions — and n8n cannot tell an untouched number field from
 * a deliberate zero. An empty box therefore sends no price at all, where a
 * numeric field would have quietly sent a free line.
 */
const positions: INodeProperties = {
	displayName: 'Positions',
	name: 'positionsUi',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Position',
	default: {},
	displayOptions: showFor(['addPositions']),
	description:
		'Позиции, добавляемые в заказ — одна строка на предложение. Adding positions leaves the ones already on the order alone; Remove Positions is what takes one away.',
	options: [
		{
			name: 'position',
			displayName: 'Position',
			values: [
				{
					displayName: 'Offer Name or ID',
					name: 'offerId',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getOffers' },
					default: '',
					required: true,
					description:
						'Предложение, которое добавляется в заказ. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				},
				{
					displayName: 'Price',
					name: 'price',
					type: 'string',
					default: '',
					placeholder: '100',
					description:
						"Цена позиции за единицу. Leave it empty to send no price at all, exactly as the platform's own example does for one of its two positions.",
				},
				{
					displayName: 'Quantity',
					name: 'quantity',
					type: 'number',
					typeOptions: { minValue: 1 },
					default: 1,
					description: 'Количество единиц в позиции',
				},
			],
		},
	],
};

export const description: INodeProperties[] = [
	operation,
	tagsPagingNotice,
	dealIdProperty(
		'deal',
		NEEDS_ORDER,
		'ID заказа в GetCourse — Get Many Tags lists them, and so does the order export in the GetCourse Legacy node',
	),
	...returnAllProperties(showFor(['getManyTags'])),
	cancelNotice,
	updateFields,
	customFieldsProperty('deal', ['updateCustomFields']),
	positions,
	{
		displayName: 'Position IDs',
		name: 'positionIds',
		type: 'string',
		default: '',
		required: true,
		placeholder: '47, 48',
		displayOptions: showFor(['removePositions']),
		description:
			"ID позиций заказа, comma-separated. These are the IDs of the positions themselves, which Get returns in the order's positions array — the offer ID is a different number.",
	},
	{
		displayName: 'Author Name or ID',
		name: 'authorId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getManagers' },
		default: '',
		required: true,
		displayOptions: showFor(['addComment']),
		description:
			'От чьего имени пишется комментарий. The list holds the account\'s managers, because that is who normally writes into an order, but the API accepts any user ID. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Comment',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		required: true,
		displayOptions: showFor(['addComment']),
		description: 'Текст комментария, каким его увидит менеджер в карточке заказа',
	},
];
