import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { toItems } from '../../helpers/request';
import { splitList } from '../../../../../utils/query';
import { unknownOperation } from '../../../../../utils/router';
import { techApiRequest } from '../../transport';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['webinar'], operation: operations },
});

/** The three operations that name a single webinar to act on. */
const SINGLE = ['addComment', 'moderateComment', 'moderateUser'];

/**
 * Вебинары — the room, its chat, and the two ways to police it.
 *
 * Two reads and three writes. The reads are the only listing the API has: no
 * filter, no paging, no search, and «Get Many» is also what the webinar
 * dropdowns elsewhere in this node are built from.
 *
 * A note on authentication: alone among the sixty-five endpoints, these five
 * declare no `security` block in GetCourse's own OpenAPI document. That is an
 * omission in the document rather than a public API — all five still document a
 * 403 — so they go through the same authenticated transport as everything else.
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getMany',
		displayOptions: { show: { resource: ['webinar'] } },
		options: [
			{
				name: 'Add Comment',
				value: 'addComment',
				action: 'Add a comment to a webinar chat',
				description:
					'Опубликовать сообщение в чате вебинара от имени модератора. GetCourse answers with an empty envelope, so the new comment gets no ID that any other call could use.',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many webinars',
				description:
					'Все вебинары аккаунта. The endpoint takes no parameters at all — no filter, no limit, no offset — so an account with many webinars returns all of them every time.',
			},
			{
				name: 'Get Many by IDs',
				value: 'getByIds',
				action: 'Get many webinars by ID',
				description:
					'Вебинары по списку ID. A read that GetCourse implemented as a POST for the sake of the array — it creates and changes nothing.',
			},
			{
				name: 'Moderate Comment',
				value: 'moderateComment',
				action: 'Moderate a webinar chat comment',
				description:
					'Удалить сообщение или пропустить его через премодерацию. Necessarily irreversible from the workflow side: nothing in the API restores a deleted comment.',
			},
			{
				name: 'Moderate User',
				value: 'moderateUser',
				action: 'Moderate a webinar chat user',
				description:
					'Забанить участника в чате вебинара или снять бан. Изоляция держится, пока её не снимут отдельным вызовом.',
			},
		],
	},
	{
		displayName:
			'Модерация применяется сразу и со стороны воркфлоу необратима: удалённое сообщение не вернуть ничем, а «Отклонить все» снимает с премодерации не только выбранный комментарий, но и все остальные сообщения того же участника, которые её ждут. Бан тоже сам не проходит — его снимает только операция Moderate User с действием «Снять изоляцию».',
		name: 'webinarModerationNotice',
		type: 'notice',
		default: '',
		displayOptions: showFor(['moderateComment', 'moderateUser']),
	},
	{
		displayName: 'Webinar Name or ID',
		name: 'webinarId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getWebinars' },
		default: '',
		required: true,
		displayOptions: showFor(SINGLE),
		description:
			'Вебинар, в чате которого работаем. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Webinar Names or IDs',
		name: 'webinarIds',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getWebinars' },
		default: [],
		required: true,
		displayOptions: showFor(['getByIds']),
		description:
			'Вебинары, которые нужно получить, — длину списка спецификация не ограничивает. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Moderator Name or ID',
		name: 'moderatorId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getManagers' },
		default: '',
		required: true,
		displayOptions: showFor(['addComment']),
		description:
			'Автор комментария — сотрудник, от чьего имени сообщение появится в чате. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		required: true,
		displayOptions: showFor(['addComment']),
		description: 'Текст сообщения, каким его увидят участники вебинара',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['addComment']),
		options: [
			{
				displayName: 'Is Private Reply',
				name: 'isPrivateReply',
				type: 'boolean',
				default: false,
				description:
					'Whether to answer the person privately (ответить лично), so the message reaches them and nobody else in the chat',
			},
			{
				displayName: 'Reply to User ID',
				name: 'replyToUserId',
				type: 'string',
				default: '',
				description: 'ID участника, на чьё сообщение отвечаем',
			},
			{
				displayName: 'Reply to User Type',
				name: 'replyToUserType',
				type: 'number',
				default: 1,
				description:
					'Тип участника, на чьё сообщение отвечаем. Спецификация не объявляет для этого поля ни одного значения и копирует пример из соседнего — известно лишь, что в модерации участников тот же параметр описан как «1 или 2».',
			},
			{
				displayName: 'Webinar Launch Number',
				name: 'webinarLaunchNumber',
				type: 'number',
				default: 0,
				description:
					'ID запуска автовебинара — нужен автовебинарам с частыми параллельными запусками или с запуском по расписанию. Оставленный нулём, он не отправляется, и GetCourse сам возьмёт ближайший или уже идущий запуск.',
			},
		],
	},
	{
		displayName: 'Comment ID',
		name: 'commentId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor(['moderateComment']),
		description:
			'ID сообщения в чате вебинара. Метода, который вернул бы комментарии, в API нет — ID приходит с вебхуком «Комментарии вебинаров», который принимает триггер этого пакета.',
	},
	{
		displayName: 'Moderation Action',
		name: 'commentAction',
		type: 'options',
		// Approval rather than deletion, because a default is what a mis-wired
		// workflow does before anybody notices, and one of these two cannot be undone.
		default: 'premoderation_accept',
		required: true,
		displayOptions: showFor(['moderateComment']),
		options: [
			{
				name: 'Accept in Premoderation (Принять)',
				value: 'premoderation_accept',
				description: 'Опубликовать сообщение, ожидающее премодерации',
			},
			{
				name: 'Delete (Удалить)',
				value: 'delete',
				description: 'Убрать сообщение из чата навсегда — восстановить его нечем',
			},
			{
				name: 'Reject All From the Author (Отклонить все)',
				value: 'premoderation_reject_all',
				description:
					'Отклонить это сообщение и заодно все остальные сообщения того же участника, ожидающие премодерации',
			},
			{
				name: 'Reject in Premoderation (Отклонить)',
				value: 'premoderation_reject',
				description: 'Отклонить только это сообщение — в чат оно не попадёт',
			},
		],
		description: 'Что сделать с сообщением',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['moderateComment']),
		options: [
			{
				displayName: 'Moderator Name or ID',
				name: 'moderatorId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getManagers' },
				default: '',
				description:
					'От чьего имени выполняется модерация — здесь метод его принимает, но не требует, в отличие от публикации комментария. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},
	{
		displayName: 'User ID',
		name: 'userId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor(['moderateUser']),
		description: 'ID участника, которого модерируем',
	},
	{
		displayName: 'User Type',
		name: 'userType',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 1,
		required: true,
		displayOptions: showFor(['moderateUser']),
		description:
			'Тип участника, который метод требует обязательно. Смысл значений не описан нигде: поле объявлено целым числом, а единственный пример в спецификации — строка «1 или 2», так что узел шлёт число и выбор оставляет за вами.',
	},
	{
		displayName: 'Moderation Action',
		name: 'userAction',
		type: 'options',
		default: 'isolation',
		required: true,
		displayOptions: showFor(['moderateUser']),
		options: [
			{
				name: 'Ban in Chat (Изоляция)',
				value: 'isolation',
				description: 'Забанить участника — писать в чат вебинара он больше не сможет',
			},
			{
				name: 'Unban in Chat (Снять изоляцию)',
				value: 'isolation_remove',
				description: 'Вернуть забаненному участнику право писать в чат',
			},
		],
		description: 'Что сделать с участником',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['moderateUser']),
		options: [
			{
				displayName: 'Moderator Name or ID',
				name: 'moderatorId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getManagers' },
				default: '',
				description:
					'От чьего имени выполняется бан — метод его принимает, но не требует. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Webinar Launch Number',
				name: 'webinarLaunchNumber',
				type: 'number',
				default: 0,
				description:
					'ID запуска автовебинара — нужен автовебинарам с частыми параллельными запусками или с запуском по расписанию. Модерация сообщений этого параметра не принимает, хотя публикация комментария и бан участника принимают оба.',
			},
		],
	},
];

/**
 * Reads a numeric parameter the way the API needs it.
 *
 * Every ID in this group is typed as an integer, and the dropdowns hand back
 * numbers — but an expression can hand back anything, and Number('abc') would
 * reach GetCourse as null, which it reports as a validation error naming a field
 * the user never touched.
 */
function requireNumber(
	this: IExecuteFunctions,
	name: string,
	itemIndex: number,
	label: string,
): number {
	const raw = String(this.getNodeParameter(name, itemIndex, '') ?? '').trim();
	const value = Number(raw);

	if (raw === '' || !Number.isFinite(value)) {
		throw new NodeOperationError(this.getNode(), `${label} must be a numeric ID`, {
			description: 'Pick the value from the list, or give the number GetCourse uses for it.',
			itemIndex,
		});
	}

	return value;
}

/** A collection field the user may have added and then left at its empty default. */
function optionalNumber(value: unknown): number | undefined {
	const parsed = Number(String(value ?? '').trim());

	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Both reads answer with an array of webinars; an account with none answers with an empty one. */
function webinarItems(data: unknown): INodeExecutionData[] {
	const rows = Array.isArray(data) ? (data as IDataObject[]) : toItems(data, {});

	return rows.map((row) => ({ json: row }));
}

/** `GET /webinar/get-all-webinars` — the whole list, because there is no other. */
async function getWebinars(this: IExecuteFunctions): Promise<INodeExecutionData[]> {
	return webinarItems(await techApiRequest.call(this, 'GET', '/webinar/get-all-webinars'));
}

/** `POST /webinar/get-webinars-by-ids` — a read, in spite of the method. */
async function getWebinarsByIds(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const selected = this.getNodeParameter('webinarIds', itemIndex, []) as unknown;

	// The picker hands back an array; an expression more often hands back the
	// comma-separated string an earlier node produced.
	const ids = (Array.isArray(selected) ? selected.map(String) : splitList(selected))
		.map((value) => Number(String(value).trim()))
		.filter((value) => Number.isFinite(value));

	if (ids.length === 0) {
		throw new NodeOperationError(this.getNode(), 'No webinars named', {
			description: 'Pick at least one webinar, or give a comma-separated list of numeric IDs.',
			itemIndex,
		});
	}

	return webinarItems(
		await techApiRequest.call(this, 'POST', '/webinar/get-webinars-by-ids', { ids }),
	);
}

async function addComment(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const webinarId = requireNumber.call(this, 'webinarId', itemIndex, 'Webinar');
	const moderatorId = requireNumber.call(this, 'moderatorId', itemIndex, 'Moderator');
	const text = String(this.getNodeParameter('text', itemIndex, '') ?? '').trim();

	if (text === '') {
		throw new NodeOperationError(this.getNode(), 'The comment has no text', {
			description: 'GetCourse takes an empty message without complaint and shows nothing for it.',
			itemIndex,
		});
	}

	const fields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
	const body: IDataObject = { webinarId, moderatorId, text };

	if (fields.isPrivateReply === true) body.isPrivateReply = true;

	const replyToUserId = optionalNumber(fields.replyToUserId);
	if (replyToUserId !== undefined) body.replyToUserId = replyToUserId;

	const replyToUserType = optionalNumber(fields.replyToUserType);
	if (replyToUserType !== undefined) body.replyToUserType = replyToUserType;

	const launch = optionalNumber(fields.webinarLaunchNumber);
	if (launch !== undefined) body.webinarLaunchNumber = launch;

	const data = await techApiRequest.call(this, 'POST', '/webinar/add-comment', body);

	// The documented success schema is the bare envelope — no data member at all —
	// so the comment's own ID never comes back and there is nothing to pass through.
	return toItems(data, { success: true, webinar_id: webinarId, moderator_id: moderatorId }).map(
		(row) => ({ json: row }),
	);
}

async function moderateComment(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const webinarId = requireNumber.call(this, 'webinarId', itemIndex, 'Webinar');
	const commentId = requireNumber.call(this, 'commentId', itemIndex, 'Comment');
	const action = this.getNodeParameter('commentAction', itemIndex, 'delete') as string;

	const fields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
	const body: IDataObject = { webinarId, commentId, action };

	const moderatorId = optionalNumber(fields.moderatorId);
	if (moderatorId !== undefined) body.moderatorId = moderatorId;

	const data = await techApiRequest.call(this, 'POST', '/webinar/moderation-comment', body);

	// The spec says this answers with an array of webinars, which is a copy-paste
	// from the two read endpoints: moderating one comment cannot produce a list of
	// rooms. Whatever does arrive is passed through, and the likely empty answer is
	// reported as the action that was taken.
	return toItems(data, {
		success: true,
		webinar_id: webinarId,
		comment_id: commentId,
		action,
	}).map((row) => ({ json: row }));
}

async function moderateUser(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const webinarId = requireNumber.call(this, 'webinarId', itemIndex, 'Webinar');
	const userId = requireNumber.call(this, 'userId', itemIndex, 'User');
	const userType = requireNumber.call(this, 'userType', itemIndex, 'User type');
	const action = this.getNodeParameter('userAction', itemIndex, 'isolation') as string;

	const fields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
	const body: IDataObject = { webinarId, userId, userType, action };

	const moderatorId = optionalNumber(fields.moderatorId);
	if (moderatorId !== undefined) body.moderatorId = moderatorId;

	const launch = optionalNumber(fields.webinarLaunchNumber);
	if (launch !== undefined) body.webinarLaunchNumber = launch;

	const data = await techApiRequest.call(this, 'POST', '/webinar/moderation-user', body);

	// No data member here either, so the ban is reported by what it was asked to do.
	return toItems(data, { success: true, webinar_id: webinarId, user_id: userId, action }).map(
		(row) => ({ json: row }),
	);
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'getMany':
			return await getWebinars.call(this);
		case 'getByIds':
			return await getWebinarsByIds.call(this, itemIndex);
		case 'addComment':
			return await addComment.call(this, itemIndex);
		case 'moderateComment':
			return await moderateComment.call(this, itemIndex);
		case 'moderateUser':
			return await moderateUser.call(this, itemIndex);
		default:
			throw unknownOperation.call(this, 'webinar', operation, itemIndex);
	}
}
