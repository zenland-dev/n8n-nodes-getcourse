import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodePropertyOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { toItems } from '../../helpers/request';
import { unknownOperation } from '../../../../../utils/router';
import { techApiRequest } from '../../transport';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['webhook'], operation: operations },
});

/**
 * Every event `POST /set-uri` can subscribe, as `<event_object_id>:<event_id>`.
 *
 * Fourteen of them, taken from the endpoint's own description. The spec's
 * request body is a `oneOf` over nine named schemas, and those nine cover only
 * nine of these pairs: `1:3`, `4:1`, `5:1`, `7:1` and `8:1` have no schema at
 * all, and object ids 4, 5, 7 and 8 have no schema of any kind. Dropping them
 * would cut the node off from most of the rest of the API — the comment ID that
 * `/webinar/moderation-comment` needs arrives only with `7:1`, and the call ID
 * that `/call/add-comment` needs only with `8:1`. The endpoint takes a pair of
 * numbers rather than a named schema, so all fourteen are offered. The traffic
 * goes one way only: nothing in the `oneOf` is missing from the description.
 *
 * Object ids 3 and 6 appear in neither the description nor the schemas, so the
 * numbering has holes and more events exist internally than are published. That
 * is the second reason the value is a plain `id:id` string — an expression can
 * name a pair this list does not.
 *
 * Ordered by event object and then by event, the way the platform's own
 * documentation reads, rather than alphabetically. Pointing `options:` at this
 * identifier is what permits that: the linter alphabetises lists of five or
 * more options only when they are written inline.
 */
export const WEBHOOK_EVENTS: INodePropertyOptions[] = [
	{
		name: 'New Dialog (Новый диалог)',
		value: '1:1',
		description: 'Входящие: создан новый диалог по сообщению ученика',
	},
	{
		name: 'Dialog Reopened (Диалог переоткрыт)',
		value: '1:2',
		description: 'Входящие: переоткрыт закрытый диалог по сообщению ученика',
	},
	{
		name: 'Message From Student (Сообщение от ученика)',
		value: '1:3',
		description:
			'Входящие: поступило новое сообщение от ученика — событие есть в описании метода, схемы запроса в спецификации у него нет',
	},
	{
		name: 'Message From Staff (Сообщение от сотрудника)',
		value: '1:4',
		description: 'Входящие: поступило новое сообщение от сотрудника',
	},
	{
		name: 'Order Created (Заказ создан)',
		value: '2:1',
		description: 'Заказы: создан новый заказ',
	},
	{
		name: 'Order Status Changed (Смена статуса заказа)',
		value: '2:2',
		description: 'Заказы: в заказе поменялся статус',
	},
	{
		name: 'Order Paid (Заказ оплачен)',
		value: '2:3',
		description: 'Заказы: заказ оплачен',
	},
	{
		name: 'Lesson Answer Added (Добавлен ответ на урок)',
		value: '4:1',
		description:
			'Комментарии к урокам: добавлен ответ на урок — событие есть в описании метода, схемы запроса в спецификации у него нет',
	},
	{
		name: 'Comment on Answer Added (Добавлен комментарий к ответу)',
		value: '5:1',
		description:
			'Комментарии к ответам: добавлен комментарий к ответу — событие есть в описании метода, схемы запроса в спецификации у него нет',
	},
	{
		name: 'Webinar Comments (Комментарии вебинара)',
		value: '7:1',
		description:
			'Комментарии вебинаров: новые комментарии от зрителей — схемы запроса в спецификации нет, но ID комментария для модерации взять больше неоткуда',
	},
	{
		name: 'New Calls (Новые звонки)',
		value: '8:1',
		description:
			'Звонки: новые звонки — схемы запроса в спецификации нет, но ID звонка для комментария и расшифровки взять больше неоткуда',
	},
	{
		name: 'HelpDesk Ticket Created (Новый тикет HelpDesk)',
		value: '9:1',
		description: 'HelpDesk: создан новый тикет по сообщению клиента',
	},
	{
		name: 'HelpDesk Message From Client (Сообщение от клиента)',
		value: '9:2',
		description: 'HelpDesk: поступило новое сообщение от клиента',
	},
	{
		name: 'HelpDesk Message From Staff (Сообщение от сотрудника)',
		value: '9:3',
		description: 'HelpDesk: поступило новое сообщение от сотрудника',
	},
];

/**
 * The subscription side of GetCourse webhooks.
 *
 * `POST /set-uri` is the whole feature: one call binds one event to one address,
 * and the same call with `subscribe: 0` releases it. There is no listing, no
 * subscription id and no delete path, so the pair «address plus event» is the
 * only handle a workflow has on what it once registered.
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'subscribe',
		displayOptions: { show: { resource: ['webhook'] } },
		options: [
			{
				name: 'Subscribe',
				value: 'subscribe',
				action: 'Subscribe a URL to an event',
				description:
					'Подписать адрес на событие: с этого момента GetCourse шлёт на него POST. One address per event, so this replaces whatever that event pointed at before, without saying what it displaced. The nine event schemas in the API reference describe this subscription request and not the payload that will be delivered.',
			},
			{
				name: 'Unsubscribe',
				value: 'unsubscribe',
				action: 'Unsubscribe a URL from an event',
				description:
					'Отписать адрес от события — тот же вызов с subscribe: 0. The URL has to be repeated exactly as it was subscribed, down to the trailing slash, because there is no subscription ID and no way to list what is currently subscribed.',
			},
		],
	},
	{
		displayName:
			'Один вызов подписывает ровно одно событие: чтобы получать несколько, вызовите узел несколько раз. Подписка принадлежит ключу разработчика, а не воркфлоу — удаление воркфлоу её не снимает, и увидеть список подписок в API нельзя, так что отписываться нужно явно и тем же адресом. The GetCourse Trigger node in this package makes and removes exactly this subscription by itself, so reach for this resource only when the trigger cannot: an address outside n8n, or a subscription somebody registered earlier and now wants inspected or cleared. На событие приходится один адрес: subscribing here replaces whatever that event already pointed at, a running GetCourse Trigger included. GetCourse answers success either way and lists nothing, so the trigger goes on reporting healthy while receiving nothing — deactivating and reactivating its workflow re-subscribes it.',
		name: 'webhookNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: ['webhook'] } },
	},
	{
		displayName: 'Event',
		name: 'event',
		type: 'options',
		default: '2:3',
		options: WEBHOOK_EVENTS,
		displayOptions: showFor(['subscribe', 'unsubscribe']),
		description:
			"Какое событие подписываем. The value is the API's own pair, written «event_object_id:event_id», so an expression can name an event this list does not carry.",
	},
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://example.com/getcourse',
		displayOptions: showFor(['subscribe', 'unsubscribe']),
		description:
			'Адрес, на который GetCourse будет слать POST с событием — поле uri в запросе. The delivery carries no signature and no shared secret of any kind, so the address itself is the only thing keeping the events private; the same address, character for character, is what an unsubscribe has to name.',
	},
];

/**
 * Reads the `event_object_id:event_id` pair out of the dropdown value.
 *
 * Both are integers in the spec, so they are sent as numbers — the endpoint is
 * PHP and would probably forgive `"2"`, but nothing in the document says so.
 */
function eventPair(this: IExecuteFunctions, event: string, itemIndex: number): [number, number] {
	const parts = event.split(':');

	// Each half is read from its own text before conversion: `Number('')` is 0 and
	// passes every integer check, so ':3' and '2:' would otherwise be accepted and
	// sent as event object 0 or event 0 — neither of which exists.
	const [objectId, eventId] = parts.map((part) => (part.trim() === '' ? NaN : Number(part.trim())));

	if (parts.length !== 2 || !Number.isInteger(objectId) || !Number.isInteger(eventId)) {
		throw new NodeOperationError(this.getNode(), `"${event}" is not a GetCourse event`, {
			description:
				'An event is written as event_object_id:event_id — 2:3, for example, is «Заказ оплачен».',
			itemIndex,
		});
	}

	return [objectId, eventId];
}

/** `POST /set-uri` — one address, one event, `subscribe` 1 to bind and 0 to release. */
async function setUri(
	this: IExecuteFunctions,
	subscribe: 0 | 1,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const url = String(this.getNodeParameter('url', itemIndex, '') ?? '').trim();

	if (url === '') {
		throw new NodeOperationError(this.getNode(), 'No URL given', {
			description:
				'Give the full address GetCourse should post to, scheme included — an unsubscribe must repeat the address it was subscribed with.',
			itemIndex,
		});
	}

	const event = String(this.getNodeParameter('event', itemIndex, '') ?? '').trim();
	const [objectId, eventId] = eventPair.call(this, event, itemIndex);

	// `subscribe` is an integer with an enum of 0 and 1, not the boolean it reads
	// as, and although its default is 1 it is always sent: an unsubscribe is the
	// same request and differs in nothing else.
	const data = await techApiRequest.call(this, 'POST', '/set-uri', {
		uri: url,
		event_object_id: objectId,
		event_id: eventId,
		subscribe,
	});

	// The 200 is declared as «Успешно» with no body schema at all, so there may be
	// nothing to pass on. What the workflow does need is the pair it just bound —
	// a delivered event carries `event_id`, and matching it to a subscription is
	// otherwise guesswork. Anything the server did send wins over the echo.
	const echo: IDataObject = {
		subscribed: subscribe === 1,
		uri: url,
		event,
		event_object_id: objectId,
		event_id: eventId,
		event_name: WEBHOOK_EVENTS.find((option) => option.value === event)?.name ?? event,
	};

	return toItems(data, {}).map((row) => ({ json: { ...echo, ...row } }));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'subscribe') return await setUri.call(this, 1, itemIndex);
	if (operation === 'unsubscribe') return await setUri.call(this, 0, itemIndex);

	throw unknownOperation.call(this, 'webhook', operation, itemIndex);
}
