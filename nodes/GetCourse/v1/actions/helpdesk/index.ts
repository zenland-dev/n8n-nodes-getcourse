import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { toItems } from '../../helpers/request';
import { unknownOperation } from '../../../../../utils/router';
import { techApiRequest } from '../../transport';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['helpdesk'], operation: operations },
});

const showForAddress = (mode: string): INodeProperties['displayOptions'] => ({
	show: { resource: ['helpdesk'], operation: ['addComment'], ticketAddressBy: [mode] },
});

/** The documented ceiling on `GET /helpdesk/get-history`, which the schema itself omits. */
const MAX_HISTORY = 1000;

/** `closedComment` is the one length-limited field in either dialog resource. */
const MAX_CLOSING_COMMENT = 255;

/**
 * The ticket id, wherever it is asked for.
 *
 * The warning matters more than the field: GetCourse stores an «Входящие» dialog
 * and a HelpDesk ticket in different tables, and the webhook calls both of them
 * `dialog_id`. A number taken from the wrong event addresses a real ticket
 * belonging to somebody else, or nothing at all.
 */
const ticketIdProperty = (displayOptions: INodeProperties['displayOptions']): INodeProperties => ({
	displayName: 'Ticket ID',
	name: 'ticketId',
	type: 'string',
	default: '',
	required: true,
	displayOptions,
	description:
		'ID тикета HelpDesk. The webhook field is called dialog_id here too (event_object_id 9), and otherwise only /user/get-helpdesk-dialogs lists tickets — an «Входящие» dialog ID is a separate ID space and must not be used here.',
});

/**
 * The channels a reply goes out over.
 *
 * A strict superset of the «Входящие» list: HelpDesk adds 11, 12 and 14. As
 * there, the values are prose in the field description rather than a declared
 * enum, so nothing on the wire rejects a channel the account has not connected.
 */
const TRANSPORTS: INodeProperties['options'] = [
	{ name: 'Chatium', value: 6 },
	{ name: 'Email', value: 1 },
	{ name: 'Facebook', value: 4 },
	{ name: 'Feedback Form (Форма обратной связи)', value: 11 },
	{ name: 'GC Form (Форма GC)', value: 12 },
	{ name: 'Instagram', value: 14 },
	{ name: 'MAX', value: 13 },
	{ name: 'Site (Сайт)', value: 0 },
	{ name: 'SMS', value: 2 },
	{ name: 'Telegram', value: 3 },
	{ name: 'Viber', value: 8 },
	{ name: 'VK', value: 5 },
	{ name: 'WhatsApp', value: 7 },
];

/**
 * HelpDesk — the ticket system that lives beside «Входящие», not inside it.
 *
 * Operation for operation this mirrors the Dialog resource, and that similarity
 * is the trap: the two run on separate tables with separate ID spaces, so a
 * number from one is meaningless to the other even though the webhook names it
 * `dialog_id` in both cases. Where they genuinely differ, they differ for a
 * reason — closing a ticket demands a reason, adding a note names its author,
 * and three more delivery channels exist here.
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'addComment',
		displayOptions: { show: { resource: ['helpdesk'] } },
		options: [
			{
				name: 'Add Comment',
				value: 'addComment',
				action: 'Add a comment to a ticket',
				description:
					'Ответ клиенту в тикете HelpDesk от имени сотрудника. Sends the text over every channel selected and opens a ticket when only a client is named; attachments would need multipart/form-data, which this node does not cover.',
			},
			{
				name: 'Add Note',
				value: 'addNote',
				action: 'Add an internal note to a ticket',
				description:
					'Внутренняя заметка к тикету, видимая только сотрудникам. Unlike the note on an «Входящие» dialog this one names its author and answers with the new note_id.',
			},
			{
				name: 'Change Department',
				value: 'changeDepartment',
				action: 'Change the department of a ticket',
				description:
					'Перевести тикет в другой отдел. Отделы are shared with «Входящие» — one list of queues serves both systems.',
			},
			{
				name: 'Close',
				value: 'close',
				action: 'Close a ticket',
				description:
					'Закрыть тикет с указанием причины. The reason is required and is what the HelpDesk reports are built from, so «без причины» is a real answer rather than a way to skip the field.',
			},
			{
				name: 'Get History',
				value: 'getHistory',
				action: 'Get the message history of a ticket',
				description:
					'Переписка тикета, в обратном хронологическом порядке. The endpoint has a message count but no offset, so only the newest messages are reachable and a long ticket cannot be walked back through.',
			},
		],
	},
	{
		displayName: 'Address By',
		name: 'ticketAddressBy',
		type: 'options',
		default: 'ticket',
		displayOptions: showFor(['addComment']),
		options: [
			{
				name: 'Client',
				value: 'client',
				description:
					'Ответить клиенту. An open ticket is reused; where there is none the platform creates one and returns its ID.',
			},
			{
				name: 'Ticket ID',
				value: 'ticket',
				description: 'Ответить в конкретный тикет, which must already exist',
			},
		],
		description:
			'Как адресовать сообщение. The API needs exactly one of the two but marks neither as required, so the node makes the choice rather than leaving it to the server.',
	},
	ticketIdProperty(showForAddress('ticket')),
	{
		displayName: 'Client ID',
		name: 'recipientId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showForAddress('client'),
		description:
			'ID ученика — получателя сообщения. With no open ticket one is created, and the response echoes ticket_id, which is the only way to learn the ID of that new ticket.',
	},
	ticketIdProperty(showFor(['addNote', 'changeDepartment', 'close', 'getHistory'])),
	{
		displayName: 'Comment Text',
		name: 'commentText',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		required: true,
		displayOptions: showFor(['addComment']),
		description: 'Текст ответа, который увидит клиент',
	},
	{
		displayName: 'Note Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		required: true,
		displayOptions: showFor(['addNote']),
		description: 'Текст заметки — виден в аккаунте и никуда не отправляется',
	},
	{
		displayName: 'Transports',
		name: 'transport',
		type: 'multiOptions',
		default: [],
		required: true,
		displayOptions: showFor(['addComment']),
		options: TRANSPORTS,
		description:
			'Каналы доставки ответа. Every channel chosen delivers the same text, so picking three sends the client three copies; the API validates nothing here beyond what the account actually has connected.',
	},
	{
		displayName: 'Author Name or ID',
		name: 'authorId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getManagers' },
		default: '',
		required: true,
		displayOptions: showFor(['addComment', 'addNote']),
		description:
			'Сотрудник, от имени которого публикуется ответ или заметка. The list holds the account\'s personal managers, the only staff listing the API publishes — another employee ID may well be accepted, so a typed ID is worth trying when someone is missing from it. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'New Department Name or ID',
		name: 'newDepartmentId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getDepartments' },
		default: '',
		required: true,
		displayOptions: showFor(['changeDepartment']),
		description:
			'Отдел, в который переводится тикет. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Closing Reason',
		name: 'closedReason',
		type: 'options',
		default: 4,
		required: true,
		displayOptions: showFor(['close']),
		options: [
			{ name: 'Client Dissatisfied (Клиент недоволен)', value: 3 },
			{ name: 'Client Satisfied (Клиент доволен)', value: 2 },
			{ name: 'Deadline Reached (По сроку)', value: 1 },
			{ name: 'No Client Reply (Нет ответа клиента)', value: 5 },
			{ name: 'No Reason (Без причины)', value: 4 },
		],
		description: 'Причина закрытия тикета, которую требует API',
	},
	{
		displayName: 'Closing Comment',
		name: 'closedComment',
		type: 'string',
		default: '',
		displayOptions: showFor(['close']),
		description: 'Комментарий к закрытию, не длиннее 255 символов',
	},
	{
		displayName: 'Message Count',
		name: 'messageCount',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: MAX_HISTORY },
		default: 100,
		displayOptions: showFor(['getHistory']),
		description:
			'Сколько последних сообщений вернуть. GetCourse caps this at 1000 and offers no offset, so a longer ticket can only ever be read from its newest end. Messages arrive newest first.',
	},
];

/**
 * Reads a required numeric ID, catching the blank and the typo before they ship.
 *
 * Either would reach the API as `null` in the JSON body, and GetCourse answers
 * that with «Ошибка данных» — a message naming neither the field nor the reason.
 */
function numericId(
	this: IExecuteFunctions,
	name: string,
	label: string,
	itemIndex: number,
): number {
	const raw = String(this.getNodeParameter(name, itemIndex, '') ?? '').trim();
	const value = Number(raw);

	if (raw === '' || !Number.isFinite(value)) {
		throw new NodeOperationError(this.getNode(), `No valid ${label} given`, {
			description: `Give the numeric ${label}.`,
			itemIndex,
		});
	}

	return value;
}

/** Reads a required free-text field, which n8n marks but does not enforce. */
function requiredText(
	this: IExecuteFunctions,
	name: string,
	label: string,
	itemIndex: number,
): string {
	const value = String(this.getNodeParameter(name, itemIndex, '') ?? '').trim();

	if (value === '') {
		throw new NodeOperationError(this.getNode(), `No ${label} given`, {
			description: `Fill in the ${label} — GetCourse rejects an empty one.`,
			itemIndex,
		});
	}

	return value;
}

/** `POST /helpdesk/add-comment` — a reply the client actually receives. */
async function addComment(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const transport = this.getNodeParameter('transport', itemIndex, []) as number[];

	if (transport.length === 0) {
		throw new NodeOperationError(this.getNode(), 'No transport chosen', {
			description:
				'Pick at least one channel for the reply. GetCourse requires the field and answers an empty one with «Не заполнено поле», which does not say which field it means.',
			itemIndex,
		});
	}

	const body: IDataObject = {
		commentText: requiredText.call(this, 'commentText', 'comment text', itemIndex),
		transport: transport.map(Number),
		userId: numericId.call(this, 'authorId', 'staff member ID', itemIndex),
	};

	// The schema marks neither addressing field as required while the prose
	// demands one of them, so the choice is made here. Sending both would leave it
	// to the server, which does not document which one it would honour.
	if (String(this.getNodeParameter('ticketAddressBy', itemIndex, 'ticket')) === 'ticket') {
		body.ticketId = numericId.call(this, 'ticketId', 'ticket ID', itemIndex);
	} else {
		body.recipientId = numericId.call(this, 'recipientId', 'client ID', itemIndex);
	}

	const data = await techApiRequest.call(this, 'POST', '/helpdesk/add-comment', body);

	// The answer carries `ticket_id`, which is how a workflow learns the ID of a
	// ticket the platform has just created for a client.
	return toItems(data, { result: true }).map((json) => ({ json }));
}

/** `POST /helpdesk/add-note` — an internal note, with an author, and it returns an ID. */
async function addNote(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const ticketId = numericId.call(this, 'ticketId', 'ticket ID', itemIndex);

	const data = await techApiRequest.call(this, 'POST', '/helpdesk/add-note', {
		ticketId,
		text: requiredText.call(this, 'text', 'note text', itemIndex),
		userId: numericId.call(this, 'authorId', 'staff member ID', itemIndex),
	});

	return toItems(data, { result: true, ticket_id: ticketId }).map((json) => ({ json }));
}

/** `POST /helpdesk/change-department` — moves the ticket into another queue. */
async function changeDepartment(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const data = await techApiRequest.call(this, 'POST', '/helpdesk/change-department', {
		ticketId: numericId.call(this, 'ticketId', 'ticket ID', itemIndex),
		newDepartmentId: numericId.call(this, 'newDepartmentId', 'department ID', itemIndex),
	});

	return toItems(data, { result: true }).map((json) => ({ json }));
}

/**
 * `POST /helpdesk/close` — the one close in the package that takes a verdict.
 *
 * The 255-character cap on the comment is declared in the schema and nowhere in
 * the interface, and an over-long one comes back as a plain «Ошибка данных» that
 * does not name the field — hence the check here rather than a round trip.
 */
async function closeTicket(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const ticketId = numericId.call(this, 'ticketId', 'ticket ID', itemIndex);
	const comment = String(this.getNodeParameter('closedComment', itemIndex, '') ?? '').trim();

	if (comment.length > MAX_CLOSING_COMMENT) {
		throw new NodeOperationError(this.getNode(), 'The closing comment is too long', {
			description: `GetCourse accepts at most ${MAX_CLOSING_COMMENT} characters here, and this one is ${comment.length}.`,
			itemIndex,
		});
	}

	const body: IDataObject = {
		ticketId,
		closedReason: Number(this.getNodeParameter('closedReason', itemIndex, 4)),
	};

	if (comment !== '') body.closedComment = comment;

	const data = await techApiRequest.call(this, 'POST', '/helpdesk/close', body);

	return toItems(data, { result: true, ticket_id: ticketId }).map((json) => ({ json }));
}

/**
 * `GET /helpdesk/get-history` — the newest messages, and only those.
 *
 * The 1000 ceiling is prose in the documentation with no `maximum` in the schema,
 * so it is applied here as well as on the field, and an over-large count is
 * clamped rather than refused: exceeding it is not documented to be an error, and
 * a silent server-side truncation would be worse than a stated one.
 */
async function getHistory(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const ticketId = numericId.call(this, 'ticketId', 'ticket ID', itemIndex);
	const wanted = Number(this.getNodeParameter('messageCount', itemIndex, 100)) || 100;

	const data = await techApiRequest.call(this, 'GET', '/helpdesk/get-history', undefined, {
		ticketId,
		limit: Math.min(Math.max(1, Math.trunc(wanted)), MAX_HISTORY),
	});

	// A ticket with no messages answers with an empty array. That is a result, not
	// the "nothing came back" that `toItems` stands in for after a write, so it
	// stays empty rather than becoming one blank item.
	if (data === null || data === undefined) return [];

	const rows = Array.isArray(data) ? (data as IDataObject[]) : toItems(data);

	return rows.map((json) => ({ json }));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'addComment':
			return await addComment.call(this, itemIndex);
		case 'addNote':
			return await addNote.call(this, itemIndex);
		case 'changeDepartment':
			return await changeDepartment.call(this, itemIndex);
		case 'close':
			return await closeTicket.call(this, itemIndex);
		case 'getHistory':
			return await getHistory.call(this, itemIndex);
		default:
			throw unknownOperation.call(this, 'helpdesk', operation, itemIndex);
	}
}
