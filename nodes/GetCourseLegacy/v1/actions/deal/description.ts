import type { INodeProperties } from 'n8n-workflow';

import {
	addFieldsProperty,
	groupsProperty,
	importNotice,
	sessionProperty,
	userIdentityProperties,
	userProfileFields,
} from '../../descriptions/common';
import {
	CURRENCIES,
	DEAL_STATUSES,
	PAYMENT_STATUSES,
	PAYMENT_TYPES,
} from '../../descriptions/constants';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['deal'], operation: operations },
});

/**
 * Both operations post the same `action=add`.
 *
 * GetCourse has no separate update route for orders: the same call creates one
 * when the order number is unknown and edits it when it is not. Splitting that
 * into two operations here is a UI decision, not an API one — changing a status
 * needs three fields and offering the other thirty alongside them helps nobody.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'import',
	displayOptions: { show: { resource: ['deal'] } },
	options: [
		{
			name: 'Import',
			value: 'import',
			action: 'Import an order',
			description:
				'Создать или обновить заказ. Creates the order, and the buyer with it if that e-mail is new. Supplying an existing order number edits that order instead.',
		},
		{
			name: 'Set Status',
			value: 'setStatus',
			action: 'Set the status of an order',
			description:
				"Изменить статус заказа. Moves an existing order to another status, identified by its order number and the buyer's e-mail.",
		},
	],
};

const minimumNotice: INodeProperties = {
	displayName:
		'Минимальный набор для нового заказа: e-mail покупателя плюс либо ID предложения, либо код предложения (или название) вместе с суммой. Editing an existing order needs the order number as well. An order carries one offer: to add a second, import again with the same order number and Append Offers switched on.',
	name: 'dealImportNotice',
	type: 'notice',
	default: '',
	displayOptions: showFor(['import']),
};

const statusNotice: INodeProperties = {
	displayName:
		'Перевод заказа в «Завершен» создаёт в нём платёж, ровно как флаг «оплачен». Moving a completed order to any other status does NOT cancel the purchases it granted, so the student keeps their access — GetCourse recommends writing the wanted status into a custom field and letting a process apply it, which does revoke access.',
	name: 'dealStatusNotice',
	type: 'notice',
	default: '',
	displayOptions: showFor(['setStatus']),
};

const dealNumberProperty: INodeProperties = {
	displayName: 'Order Number',
	name: 'deal_number',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['setStatus']),
	description:
		'Номер заказа. The number shown in the account and returned by an import, not the internal order ID.',
};

const statusProperty: INodeProperties = {
	displayName: 'Status',
	name: 'deal_status',
	type: 'options',
	default: 'new',
	required: true,
	options: DEAL_STATUSES,
	displayOptions: showFor(['setStatus']),
	description: 'Статус заказа, into which the order is moved',
};

const offerProperties: INodeProperties[] = [
	{
		displayName: 'Offer ID',
		name: 'offer_id',
		type: 'string',
		default: '',
		displayOptions: showFor(['import']),
		description:
			'ID предложения. The most reliable way to name an offer: when it is given, the offer code, title and description are ignored, and an ID that matches nothing fails the whole request instead of inventing a product.',
	},
	{
		displayName: 'Offer Code',
		name: 'offer_code',
		type: 'string',
		default: '',
		displayOptions: showFor(['import']),
		description:
			"Уникальный код предложения, from the offer's settings page. Used only when Offer ID is empty.",
	},
	{
		displayName: 'Amount',
		name: 'deal_cost',
		type: 'number',
		default: 0,
		typeOptions: { minValue: 0 },
		displayOptions: showFor(['import']),
		description:
			"Сумма заказа. Required alongside an offer code or a product title. With an Offer ID it is optional — leave it at zero and the offer's own price is used.",
	},
];

const dealFields: INodeProperties = {
	displayName: 'Order Fields',
	name: 'dealFields',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	displayOptions: showFor(['import']),
	options: [
		{
			displayName: 'Append Offers',
			name: 'multiple_offers',
			type: 'boolean',
			default: false,
			description:
				'Whether to add this offer to an existing order rather than replace its contents (multiple_offers). One request carries one offer, so several offers mean several requests: the first without this flag, the rest with it and the same order number.',
		},
		{
			displayName: 'Comment',
			name: 'deal_comment',
			type: 'string',
			typeOptions: { rows: 3 },
			default: '',
			description: 'Комментарий к заказу',
		},
		{
			displayName: 'Created At',
			name: 'deal_created_at',
			type: 'dateTime',
			default: '',
			description:
				'Дата заказа. Backdates the order; leave empty for the moment of the request. Sent as YYYY-MM-DD HH:MM:SS in the workflow timezone.',
		},
		{
			displayName: 'Currency',
			name: 'deal_currency',
			type: 'options',
			default: 'RUB',
			options: CURRENCIES,
			description:
				'Код валюты заказа. Omitting it means roubles. The account may support codes beyond this list — an expression can supply one.',
		},
		{
			displayName: 'Finished At',
			name: 'deal_finished_at',
			type: 'dateTime',
			default: '',
			description:
				'Дата оплаты или завершения заказа. Sent as YYYY-MM-DD HH:MM:SS in the workflow timezone.',
		},
		{
			displayName: 'Funnel ID',
			name: 'funnel_id',
			type: 'string',
			default: '',
			description: 'ID доски продаж, onto which the order is placed',
		},
		{
			displayName: 'Funnel Stage ID',
			name: 'funnel_stage_id',
			type: 'string',
			default: '',
			description: 'ID этапа на доске продаж. Only meaningful together with a Funnel ID.',
		},
		{
			displayName: 'Manager Email',
			name: 'manager_email',
			type: 'string',
			placeholder: 'manager@example.com',
			default: '',
			description: 'Email менеджера, assigned to the order',
		},
		{
			displayName: 'Mark as Paid',
			name: 'deal_is_paid',
			type: 'boolean',
			default: false,
			description:
				'Whether to record the order as paid (оплачен). This creates a payment on the order, the same as moving it to the Completed status.',
		},
		{
			displayName: 'Order Number',
			name: 'deal_number',
			type: 'string',
			default: '',
			description:
				'Номер заказа. Leave empty to let GetCourse assign one. Supplying a number that already exists edits that order instead of creating a new one — which is how an import is repeated safely.',
		},
		{
			displayName: 'Partner Email',
			name: 'partner_email',
			type: 'string',
			placeholder: 'partner@example.com',
			default: '',
			description:
				"Email партнёра для заказа. An order may credit a different partner than the buyer's own. A partner who does not exist is an error.",
		},
		{
			displayName: 'Payment Status',
			name: 'payment_status',
			type: 'options',
			default: 'expected',
			options: PAYMENT_STATUSES,
			description: 'Статус платежа',
		},
		{
			displayName: 'Payment Type',
			name: 'payment_type',
			type: 'options',
			default: 'OTHER',
			options: PAYMENT_TYPES,
			description: 'Тип платежа',
		},
		{
			displayName: 'Product Description',
			name: 'product_description',
			type: 'string',
			typeOptions: { rows: 2 },
			default: '',
			description: 'Описание продукта. Ignored when Offer ID is set.',
		},
		{
			displayName: 'Product Title',
			name: 'product_title',
			type: 'string',
			default: '',
			description:
				'Наименование предложения. Stands in for the offer code when the offer has none. Ignored when Offer ID is set.',
		},
		{
			displayName: 'Quantity',
			name: 'quantity',
			type: 'number',
			typeOptions: { minValue: 1 },
			default: 1,
			description: 'Количество единиц предложения в заказе',
		},
		{
			displayName: 'Return Order Number',
			name: 'return_deal_number',
			type: 'boolean',
			default: true,
			description:
				'Whether to include the assigned order number in the answer (return_deal_number). Without it a newly created order comes back as an ID only, and repeating the import safely needs the number.',
		},
		{
			displayName: 'Return Payment Link',
			name: 'return_payment_link',
			type: 'boolean',
			default: false,
			description:
				'Whether to include a link to the payment page in the answer (return_payment_link). Useful when the workflow goes on to send the buyer an invoice.',
		},
		{
			displayName: 'Status',
			name: 'deal_status',
			type: 'options',
			default: 'new',
			options: DEAL_STATUSES,
			description: 'Статус заказа at creation',
		},
	],
};

const userFields: INodeProperties = {
	displayName: 'Buyer Fields',
	name: 'userFields',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	displayOptions: showFor(['import']),
	description:
		'Данные покупателя. Filled in only when the import creates the person; an existing one is left alone unless Update Existing Buyer is on.',
	options: [
		...userProfileFields(),
		{
			displayName: 'Partner Email',
			name: 'partner_email',
			type: 'string',
			placeholder: 'partner@example.com',
			default: '',
			description:
				'Email партнёра для пользователя, as opposed to the partner credited for the order',
		},
		{
			displayName: 'Update Existing Buyer',
			name: 'refresh_if_exists',
			type: 'boolean',
			default: false,
			description:
				"Whether to refresh a known buyer's profile from the fields above (обновлять существующего). It never affects the order itself — only the person.",
		},
	],
};

export const description: INodeProperties[] = [
	operation,
	importNotice('dealApiNotice', showFor(['import'])),
	minimumNotice,
	statusNotice,
	...userIdentityProperties(showFor(['import', 'setStatus']), {
		emailDescription:
			'Электронная почта покупателя. GetCourse matches the order to this person, creating them if the address is new.',
	}),
	dealNumberProperty,
	statusProperty,
	...offerProperties,
	dealFields,
	addFieldsProperty(showFor(['import']), 'getDealCustomFields', 'заказа'),
	userFields,
	groupsProperty(showFor(['import'])),
	sessionProperty(showFor(['import'])),
];
