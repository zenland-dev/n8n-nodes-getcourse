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
	show: { resource: ['dialog'], operation: operations },
});

const showForAddress = (mode: string): INodeProperties['displayOptions'] => ({
	show: { resource: ['dialog'], operation: ['addComment'], dialogAddressBy: [mode] },
});

/** The documented ceiling on `GET /dialog/get-history`, which the schema itself omits. */
const MAX_HISTORY = 1000;

/**
 * The dialog id, wherever it is asked for.
 *
 * Written once because the sentence that matters — where the number comes from —
 * is the same in all five places, and because getting it wrong is the likeliest
 * way to build a workflow that only fails in production.
 */
const dialogIdProperty = (displayOptions: INodeProperties['displayOptions']): INodeProperties => ({
	displayName: 'Dialog ID',
	name: 'dialogId',
	type: 'string',
	default: '',
	required: true,
	displayOptions,
	description:
		'ID диалога во «Входящие». The webhook field dialog_id carries it (event_object_id 1), and otherwise only /user/get-dialogs lists dialogs at all — a HelpDesk ticket ID belongs to a separate ID space and must not be used here.',
});

/**
 * The channels a reply goes out over.
 *
 * The API documents them as prose inside the field description and declares no
 * enum, so nothing on the wire rejects a number that is not in this list. The
 * HelpDesk endpoint takes three more (11 Форма обратной связи, 12 Форма GC,
 * 14 Instagram), which is why the two resources keep separate lists rather than
 * sharing one that would offer «Входящие» a channel it cannot deliver over.
 */
const TRANSPORTS: INodeProperties['options'] = [
	{ name: 'Chatium', value: 6 },
	{ name: 'Email', value: 1 },
	{ name: 'Facebook', value: 4 },
	{ name: 'MAX', value: 13 },
	{ name: 'Site (Сайт)', value: 0 },
	{ name: 'SMS', value: 2 },
	{ name: 'Telegram', value: 3 },
	{ name: 'Viber', value: 8 },
	{ name: 'VK', value: 5 },
	{ name: 'WhatsApp', value: 7 },
];

/**
 * «Входящие» — the inbox a student's messages arrive in.
 *
 * Four of the five operations write, and none of them is idempotent in the way a
 * retry usually assumes: a second Add Comment sends the student a second message
 * over every channel chosen, and there is no idempotency key. A retry after a
 * timeout belongs behind a Get History check, not in an error branch.
 *
 * Nothing in the API lists dialogs, so every operation here needs an ID that
 * arrived from somewhere else — a webhook delivery, or /user/get-dialogs.
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'addComment',
		displayOptions: { show: { resource: ['dialog'] } },
		options: [
			{
				name: 'Add Comment',
				value: 'addComment',
				action: 'Add a comment to a dialog',
				description:
					'Ответ ученику во «Входящие» от имени сотрудника. Sends the text over every channel selected and opens a dialog when only a student is named; attachments would need multipart/form-data, which this node does not cover.',
			},
			{
				name: 'Add Note',
				value: 'addNote',
				action: 'Add an internal note to a dialog',
				description:
					'Внутренняя заметка во «Входящие», видимая только сотрудникам. The endpoint takes no author, so the platform alone decides whose name the note carries, and it answers with nothing — not even the note ID.',
			},
			{
				name: 'Change Department',
				value: 'changeDepartment',
				action: 'Change the department of a dialog',
				description:
					'Перевести диалог в другой отдел. Отделы are the queues «Входящие» routes conversations between, and the same list serves HelpDesk.',
			},
			{
				name: 'Close',
				value: 'close',
				action: 'Close a dialog',
				description:
					'Закрыть диалог. Unlike a HelpDesk ticket this takes no reason and no comment, and a further message from the student reopens the dialog rather than starting a new one.',
			},
			{
				name: 'Get History',
				value: 'getHistory',
				action: 'Get the message history of a dialog',
				description:
					'Переписка диалога, в обратном хронологическом порядке. The endpoint has a message count but no offset, so only the newest messages are reachable and a long dialog cannot be walked back through.',
			},
		],
	},
	{
		displayName: 'Address By',
		name: 'dialogAddressBy',
		type: 'options',
		default: 'dialog',
		displayOptions: showFor(['addComment']),
		options: [
			{
				name: 'Dialog ID',
				value: 'dialog',
				description: 'Ответить в конкретный диалог, which must already exist',
			},
			{
				name: 'Student',
				value: 'student',
				description:
					'Ответить ученику. An open dialog is reused; where there is none the platform creates one and returns its ID.',
			},
		],
		description:
			'Как адресовать сообщение. The API needs exactly one of the two but marks neither as required, so the node makes the choice rather than leaving it to the server.',
	},
	dialogIdProperty(showForAddress('dialog')),
	{
		displayName: 'Student ID',
		name: 'recipientId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showForAddress('student'),
		description:
			'ID ученика — получателя сообщения. With no open dialog one is created, and the response echoes dialog_id, which is the only way to learn the ID of that new dialog.',
	},
	dialogIdProperty(showFor(['addNote', 'changeDepartment', 'close', 'getHistory'])),
	{
		displayName: 'Comment Text',
		name: 'commentText',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		required: true,
		displayOptions: showFor(['addComment']),
		description: 'Текст ответа, который увидит ученик',
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
			'Каналы доставки ответа. Every channel chosen delivers the same text, so picking three sends the student three copies; the API validates nothing here beyond what the account actually has connected.',
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
			'Сотрудник, от имени которого публикуется ответ. The list holds the account\'s personal managers, the only staff listing the API publishes — another employee ID may well be accepted, so a typed ID is worth trying when someone is missing from it. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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
			'Отдел, в который переводится диалог. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Message Count',
		name: 'messageCount',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: MAX_HISTORY },
		default: 100,
		displayOptions: showFor(['getHistory']),
		description:
			'Сколько последних сообщений вернуть. GetCourse caps this at 1000 and offers no offset, so a longer dialog can only ever be read from its newest end. Messages arrive newest first.',
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

/** `POST /dialog/add-comment` — a reply the student actually receives. */
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
	if (String(this.getNodeParameter('dialogAddressBy', itemIndex, 'dialog')) === 'dialog') {
		body.dialogId = numericId.call(this, 'dialogId', 'dialog ID', itemIndex);
	} else {
		body.recipientId = numericId.call(this, 'recipientId', 'student ID', itemIndex);
	}

	const data = await techApiRequest.call(this, 'POST', '/dialog/add-comment', body);

	// The answer carries `dialog_id`, which is how a workflow learns the ID of a
	// dialog the platform has just created for a student.
	return toItems(data, { result: true }).map((json) => ({ json }));
}

/**
 * `POST /note/add` — the one operation here whose path is not `/dialog/…`.
 *
 * GetCourse tags it «Диалог» all the same. It is also the only endpoint in this
 * resource that answers `data: null` on success — no note ID, no echo of
 * anything — so the output item is built from what was sent.
 */
async function addNote(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const dialogId = numericId.call(this, 'dialogId', 'dialog ID', itemIndex);

	const data = await techApiRequest.call(this, 'POST', '/note/add', {
		dialogId,
		text: requiredText.call(this, 'text', 'note text', itemIndex),
	});

	return toItems(data, { result: true, dialog_id: dialogId }).map((json) => ({ json }));
}

/** `POST /dialog/change-department` — moves the dialog into another queue. */
async function changeDepartment(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const data = await techApiRequest.call(this, 'POST', '/dialog/change-department', {
		dialogId: numericId.call(this, 'dialogId', 'dialog ID', itemIndex),
		newDepartmentId: numericId.call(this, 'newDepartmentId', 'department ID', itemIndex),
	});

	return toItems(data, { result: true }).map((json) => ({ json }));
}

/** `POST /dialog/close` — no reason and no comment, unlike its HelpDesk twin. */
async function closeDialog(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const dialogId = numericId.call(this, 'dialogId', 'dialog ID', itemIndex);

	const data = await techApiRequest.call(this, 'POST', '/dialog/close', { dialogId });

	return toItems(data, { result: true, dialog_id: dialogId }).map((json) => ({ json }));
}

/**
 * `GET /dialog/get-history` — the newest messages, and only those.
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
	const dialogId = numericId.call(this, 'dialogId', 'dialog ID', itemIndex);
	const wanted = Number(this.getNodeParameter('messageCount', itemIndex, 100)) || 100;

	const data = await techApiRequest.call(this, 'GET', '/dialog/get-history', undefined, {
		dialogId,
		limit: Math.min(Math.max(1, Math.trunc(wanted)), MAX_HISTORY),
	});

	// A dialog with no messages answers with an empty array. That is a result, not
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
			return await closeDialog.call(this, itemIndex);
		case 'getHistory':
			return await getHistory.call(this, itemIndex);
		default:
			throw unknownOperation.call(this, 'dialog', operation, itemIndex);
	}
}
