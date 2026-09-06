import type { INodePropertyOptions } from 'n8n-workflow';

/**
 * The events `POST /pl/api/v1/set-uri` can subscribe to.
 *
 * Taken from that endpoint's own prose description, not from its request schema:
 * the schema is a `oneOf` over nine bodies and covers only some of the events the
 * description lists — objects 4, 5, 7 and 8 have no schema at all, and neither
 * does the dialog "message from a student" case. Generating the list from the
 * schema would silently drop five events that work.
 *
 * Shared by the trigger, which subscribes on activation, and by the Webhook
 * resource of the action node, which does it by hand.
 */

export interface EventObject {
	/** `event_object_id` in the request body. */
	id: number;
	/** What the option is called in the interface. */
	label: string;
	/** `event_id` values, by their own label. */
	events: Array<{ id: number; label: string; description: string }>;
}

export const EVENT_OBJECTS: EventObject[] = [
	{
		id: 1,
		label: 'Incoming Messages',
		events: [
			{
				id: 1,
				label: 'Dialog Created',
				description: 'Создан новый диалог по сообщению ученика',
			},
			{
				id: 2,
				label: 'Dialog Reopened',
				description: 'Переоткрыт закрытый диалог по сообщению ученика',
			},
			{ id: 3, label: 'Message From Student', description: 'Поступило новое сообщение от ученика' },
			{
				id: 4,
				label: 'Message From Staff',
				description: 'Поступило новое сообщение от сотрудника',
			},
		],
	},
	{
		id: 2,
		label: 'Orders',
		events: [
			{ id: 1, label: 'Order Created', description: 'Создан новый заказ' },
			{ id: 2, label: 'Order Status Changed', description: 'Смена статуса заказа' },
			{ id: 3, label: 'Order Paid', description: 'Заказ оплачен' },
		],
	},
	{
		id: 4,
		label: 'Lesson Answers',
		events: [{ id: 1, label: 'Answer Added', description: 'Добавлен ответ на урок' }],
	},
	{
		id: 5,
		label: 'Answer Comments',
		events: [{ id: 1, label: 'Comment Added', description: 'Добавлен комментарий к ответу' }],
	},
	{
		id: 7,
		label: 'Webinar Comments',
		events: [
			{ id: 1, label: 'Comment Posted', description: 'Получение новых комментариев от зрителей' },
		],
	},
	{
		id: 8,
		label: 'Calls',
		events: [{ id: 1, label: 'Call Registered', description: 'Получение новых звонков' }],
	},
	{
		id: 9,
		label: 'HelpDesk',
		events: [
			{ id: 1, label: 'Ticket Created', description: 'Создан новый тикет по сообщению клиента' },
			{ id: 2, label: 'Message From Client', description: 'Поступило новое сообщение от клиента' },
			{
				id: 3,
				label: 'Message From Staff',
				description: 'Поступило новое сообщение от сотрудника',
			},
		],
	},
];

/** The object selector, in the order GetCourse numbers them. */
export const EVENT_OBJECT_OPTIONS: INodePropertyOptions[] = EVENT_OBJECTS.map((object) => ({
	name: object.label,
	value: object.id,
	description: `event_object_id ${object.id}`,
}));

/** The events of one object, as options whose value is the bare `event_id`. */
export function eventOptions(objectId: number): INodePropertyOptions[] {
	const object = EVENT_OBJECTS.find((candidate) => candidate.id === objectId);

	return (object?.events ?? []).map((event) => ({
		name: event.label,
		value: event.id,
		description: `${event.description} (event_id ${event.id})`,
	}));
}

/**
 * Every pair, flattened, as `"<object>:<event>"`.
 *
 * The Webhook resource of the action node offers this as one list, because it
 * subscribes one pair per call and has no reason to make the user pick an object
 * first. The trigger does make them pick, for a reason of its own — see the note
 * on ambiguity in the trigger.
 */
export const EVENT_PAIR_OPTIONS: INodePropertyOptions[] = EVENT_OBJECTS.flatMap((object) =>
	object.events.map((event) => ({
		name: `${object.label}: ${event.label}`,
		value: `${object.id}:${event.id}`,
		description: `${event.description} (event_object_id ${object.id}, event_id ${event.id})`,
	})),
);
