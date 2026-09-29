import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { returnAllProperties } from '../../descriptions/common';
import { toItems } from '../../helpers/request';
import { splitList } from '../../../../../utils/query';
import { unknownOperation } from '../../../../../utils/router';
import { techApiRequest } from '../../transport';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['school'], operation: operations },
});

/**
 * Filters of the mailing list and of mailing statistics. The two endpoints share them, except
 * that only the list takes a parent and a title.
 */
function mailingFilters(operations: string[], forList: boolean): INodeProperties {
	const options: INodeProperties[] = [
		{
			displayName: 'Category ID',
			name: 'categoryId',
			type: 'number',
			default: 0,
			description: 'ID категории рассылок',
		},
		{
			displayName: 'Mailing IDs',
			name: 'mailingIds',
			type: 'string',
			default: '',
			placeholder: '101, 102',
			description: 'ID рассылок, comma-separated',
		},
	];
	if (forList) {
		options.push(
			{
				displayName: 'Parent Mailing ID',
				name: 'parentId',
				type: 'number',
				default: 0,
				description: 'ID родительской рассылки — only the mailings made from it',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				description: 'Часть названия рассылки. GetCourse finds it anywhere in the title.',
			},
		);
	}
	options.push(
		{
			displayName: 'Transport',
			name: 'transport',
			type: 'string',
			default: '',
			placeholder: 'email',
			description: 'Канал рассылки по имени — email, sms, vk, ticket and the like, not an ID',
		},
		{
			displayName: 'Type',
			name: 'type',
			type: 'options',
			default: 'manual',
			options: [
				{ name: 'Manual (Ручная)', value: 'manual' },
				{ name: 'Notification (Уведомление)', value: 'notification' },
				{ name: 'Queue (Из очереди)', value: 'queue' },
				{ name: 'Template (По шаблону)', value: 'template' },
			],
			description: 'Тип рассылки',
		},
	);

	return {
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: showFor(operations),
		options,
	};
}

/**
 * The account's own dictionaries.
 *
 * Four of these take no parameters and are the same lists the node's dropdowns
 * read; they are exposed as operations because a workflow often needs the whole
 * list rather than one picked value — to map a group name onto an id, say, or to
 * iterate every training.
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getGroups',
		displayOptions: { show: { resource: ['school'] } },
		options: [
			{
				name: 'Get Mailing Content',
				value: 'getMailingContent',
				action: 'Get the content of a mailing',
				description:
					'Тема, текст и файлы одной рассылки. The list does not carry them, so this is the call that reads what a mailing says.',
			},
			{
				name: 'Get Mailing Stats',
				value: 'getMailingStats',
				action: 'Get mailing statistics',
				description:
					'Статистика рассылок — одна строка на рассылку: получатели, доставлено, просмотры, переходы, ответы, ошибки, отписки. A row carries the mailing ID and no title; Get Many Mailings has the titles.',
			},
			{
				name: 'Get Many Departments',
				value: 'getDepartments',
				action: 'Get many departments',
				description:
					'Отделы школы. Departments are what dialogs and HelpDesk tickets are routed between.',
			},
			{
				name: 'Get Many Groups',
				value: 'getGroups',
				action: 'Get many user groups',
				description: 'Группы пользователей аккаунта, with their IDs',
			},
			{
				name: 'Get Many Mailings',
				value: 'getMailings',
				action: 'Get many mailings',
				description:
					'Рассылки школы, от новых к старым: название, тип, канал, категория. Include Settings adds whom each one goes to, from whom and when.',
			},
			{
				name: 'Get Many Personal Managers',
				value: 'getManagers',
				action: 'Get many personal managers',
				description:
					'Сотрудники с правами менеджера. Returns full user records, which is where the author ID for a comment comes from.',
			},
			{
				name: 'Get Many Trainings',
				value: 'getTrainings',
				action: 'Get many trainings',
				description: 'Тренинги аккаунта, with their lesson counts and status',
			},
			{
				name: 'Get Scale Results',
				value: 'getScaleResults',
				action: 'Get the results of achievement scales',
				description:
					'Баллы пользователей по шкалам достижений — одна строка на пользователя и шкалу. No endpoint names the scales, so a row carries only the scale ID.',
			},
			{
				name: 'Get Survey Answers',
				value: 'getSurveyAnswers',
				action: 'Get the answers to a survey',
				description:
					'Ответы на анкету. The one endpoint in the whole API that reports a total, so paging through it is exact.',
			},
		],
	},
	{
		displayName: 'Survey ID',
		name: 'surveyId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor(['getSurveyAnswers']),
		description:
			"ID анкеты. There is no endpoint listing surveys — the ID comes from the survey's address in the account.",
	},
	{
		displayName: 'Mailing ID',
		name: 'mailingId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor(['getMailingContent']),
		description: 'ID рассылки — the ID column of Get Many Mailings',
	},
	...returnAllProperties(showFor(['getMailings', 'getMailingStats', 'getScaleResults', 'getSurveyAnswers'])),
	{
		displayName: 'Include Settings',
		name: 'includeSettings',
		type: 'boolean',
		default: false,
		displayOptions: showFor(['getMailings']),
		description:
			'Whether to add the sending settings of each mailing under params: recipients, sender, reply address, schedule and design (showInfo)',
	},
	mailingFilters(['getMailings'], true),
	mailingFilters(['getMailingStats'], false),
	{
		displayName: 'Resolve Question Titles',
		name: 'resolveQuestions',
		type: 'boolean',
		default: true,
		displayOptions: showFor(['getSurveyAnswers']),
		description:
			'Whether to key each answer by the question text rather than its ID (подставить тексты вопросов). GetCourse answers with two objects — a question map and an answer map keyed by question ID — and joining them is almost always what a workflow wants.',
	},
];

/** `GET /common/get-survey-answer` — the only paged endpoint with a real total. */
async function getSurveyAnswers(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const surveyId = String(this.getNodeParameter('surveyId', itemIndex, '') ?? '').trim();

	if (surveyId === '') {
		throw new NodeOperationError(this.getNode(), 'No survey named', {
			description: 'Give the numeric survey ID.',
			itemIndex,
		});
	}

	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
	const wanted = returnAll ? Number.POSITIVE_INFINITY : Math.max(1, limit);
	const resolve = this.getNodeParameter('resolveQuestions', itemIndex, true) as boolean;

	const pageSize = 1000; // The endpoint's documented maximum, and the only one in the API.
	const collected: IDataObject[] = [];
	let questions: IDataObject = {};

	for (let offset = 0; collected.length < wanted; offset += pageSize) {
		const page = (await techApiRequest.call(this, 'GET', '/common/get-survey-answer', undefined, {
			surveyId: Number(surveyId),
			limit: Math.min(pageSize, wanted - collected.length),
			offset,
		})) as IDataObject | undefined;

		const answers = page?.answers;
		if (!Array.isArray(answers) || answers.length === 0) break;

		questions = (page?.questions ?? questions) as IDataObject;
		collected.push(...(answers as IDataObject[]));

		const total = Number(page?.total_count);
		if (Number.isFinite(total) && collected.length >= total) break;
		if (answers.length < pageSize) break;
	}

	const rows = returnAll ? collected : collected.slice(0, wanted);

	return rows.map((answer) => ({ json: resolve ? withQuestionTitles(answer, questions) : answer }));
}

/**
 * `GET /common/get-scale` — every user's standing on every achievement scale.
 *
 * Paged by `limit` (at most 1000) and `offset`, with no total and no filter, so
 * the walk stops on the first short page. An account without scales answers an
 * empty list, which stays empty.
 */
async function getScaleResults(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
	const wanted = returnAll ? Number.POSITIVE_INFINITY : Math.max(1, limit);

	const pageSize = 1000; // The documented maximum.
	const collected: IDataObject[] = [];

	for (let offset = 0; collected.length < wanted; offset += pageSize) {
		const page = await techApiRequest.call(this, 'GET', '/common/get-scale', undefined, {
			limit: Math.min(pageSize, wanted - collected.length),
			offset,
		});

		const rows = Array.isArray(page) ? (page as IDataObject[]) : [];
		collected.push(...rows);
		if (rows.length < pageSize) break;
	}

	return collected.slice(0, wanted).map((row) => ({ json: row }));
}

/**
 * Joins an answer row to the survey's question map.
 *
 * The API keeps them apart — `answers` is keyed by question id, `questions` maps
 * those ids to their text — so on its own a row reads `{"3": "Да"}`. The raw map
 * is kept alongside, because a question can be renamed and an id cannot.
 */
function withQuestionTitles(answer: IDataObject, questions: IDataObject): IDataObject {
	const raw = (answer.answers ?? {}) as IDataObject;
	const resolved: IDataObject = {};
	const used = new Map<string, number>();

	for (const [questionId, value] of Object.entries(raw)) {
		const title = String(questions[questionId] ?? '').trim();
		const base = title === '' ? questionId : title;

		// Nothing stops a survey from asking «Комментарий» twice, and a repeated
		// title would otherwise overwrite the earlier answer — losing data in a way
		// nobody would notice, since the key that survives looks perfectly normal.
		const seen = used.get(base) ?? 0;
		used.set(base, seen + 1);

		resolved[seen === 0 ? base : `${base} (${questionId})`] = value;
	}

	return { ...answer, answers: resolved, answers_by_id: raw };
}

/** The query of the mailing list and statistics filters; blanks and zeros are left out. */
function mailingQuery(this: IExecuteFunctions, itemIndex: number, forList: boolean): IDataObject {
	const filters = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
	const qs: IDataObject = {};

	const categoryId = Number(filters.categoryId);
	if (Number.isInteger(categoryId) && categoryId > 0) qs.categoryId = categoryId;

	const ids = splitList(filters.mailingIds).map((value) => {
		const id = Number(value);
		if (!Number.isInteger(id) || id <= 0) {
			throw new NodeOperationError(this.getNode(), `"${value}" is not a mailing ID`, {
				description: 'Mailing IDs takes numeric IDs, comma-separated.',
				itemIndex,
			});
		}
		return id;
	});
	if (ids.length > 0) qs.ids = ids;

	if (forList) {
		const parentId = Number(filters.parentId);
		if (Number.isInteger(parentId) && parentId > 0) qs.parentId = parentId;
		const title = String(filters.title ?? '').trim();
		if (title !== '') qs.title = title;
	}

	const transport = String(filters.transport ?? '').trim();
	if (transport !== '') qs.transport = transport;
	if (typeof filters.type === 'string' && filters.type !== '') qs.type = filters.type;

	return qs;
}

/**
 * Walks `limit`/`offset` pages of 1000 — the maximum, since 1001 is refused with 400 — until a
 * page comes back short. Neither mailing endpoint reports a total.
 *
 * The list is newest first, so a mailing made while the pages are read pushes everything down a
 * row and the next page repeats the last row of the previous one. A school sending all the time
 * does that within a long walk; a row whose ID has already come back is dropped.
 */
async function mailingPages(
	this: IExecuteFunctions,
	itemIndex: number,
	endpoint: string,
	qs: IDataObject,
	rowsOf: (data: unknown) => IDataObject[],
): Promise<IDataObject[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
	const wanted = returnAll ? Number.POSITIVE_INFINITY : Math.max(1, limit);

	const pageSize = 1000;
	const collected: IDataObject[] = [];
	const seen = new Set<string>();

	for (let offset = 0; collected.length < wanted; ) {
		// A dropped repeat leaves room for more, so the offset moves by what was asked, not by 1000.
		const asked = Math.min(pageSize, wanted - collected.length);
		const data = await techApiRequest.call(
			this,
			'GET',
			endpoint,
			undefined,
			{ ...qs, limit: asked, offset },
			// ids[]=1&ids[]=2 — a comma list or a repeated key answers 500.
			{ arrayFormat: 'brackets' },
		);
		offset += asked;
		const rows = rowsOf(data);
		for (const row of rows) {
			const key = row.id === undefined || row.id === null ? undefined : String(row.id);
			if (key !== undefined && seen.has(key)) continue;
			if (key !== undefined) seen.add(key);
			collected.push(row);
		}
		if (rows.length < asked) break;
	}

	return collected.slice(0, wanted);
}

/** `GET /common/get-mailing` — newest first. */
async function getMailings(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const qs = mailingQuery.call(this, itemIndex, true);
	if (this.getNodeParameter('includeSettings', itemIndex, false) === true) qs.showInfo = true;

	const rows = await mailingPages.call(this, itemIndex, '/common/get-mailing', qs, (data) =>
		Array.isArray(data) ? (data as IDataObject[]) : [],
	);

	return rows.map((row) => ({ json: row }));
}

/**
 * `GET /common/get-mailing-stat` — an object keyed by mailing ID, each value carrying its own
 * `id`. An empty answer is `[]`, a PHP empty array. Rows go out newest first, as the list does:
 * a JavaScript object sorts numeric keys upwards whatever order they arrived in.
 */
async function getMailingStats(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const qs = mailingQuery.call(this, itemIndex, false);

	const rows = await mailingPages.call(this, itemIndex, '/common/get-mailing-stat', qs, (data) => {
		if (data === null || typeof data !== 'object') return [];
		const entries = Object.entries(data as IDataObject).map(([key, value]) => ({
			...(value as IDataObject),
			id: (value as IDataObject)?.id ?? Number(key),
		}));
		return entries.sort((a, b) => Number(b.id) - Number(a.id));
	});

	return rows.map((row) => ({ json: row }));
}

/**
 * `GET /common/get-mailing-content` — subject, body and files of one mailing. `files` arrives as
 * JSON written into a string; it goes out parsed, and the string as it came under `files_json`.
 */
async function getMailingContent(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const raw = String(this.getNodeParameter('mailingId', itemIndex, '') ?? '').trim();
	const id = Number(raw);

	if (raw === '' || !Number.isInteger(id) || id <= 0) {
		throw new NodeOperationError(this.getNode(), 'No mailing named', {
			description: 'Give the numeric mailing ID from Get Many Mailings.',
			itemIndex,
		});
	}

	const data = ((await techApiRequest.call(this, 'GET', '/common/get-mailing-content', undefined, {
		id,
	})) ?? {}) as IDataObject;

	if (typeof data.files === 'string' && data.files.trim() !== '') {
		try {
			return [{ json: { ...data, files: JSON.parse(data.files) as IDataObject, files_json: data.files } }];
		} catch {
			// Not JSON after all: leave it as it came.
		}
	}

	return [{ json: data }];
}

const DICTIONARIES: Record<string, string> = {
	getDepartments: '/common/get-departments',
	getGroups: '/common/get-groups',
	getManagers: '/common/get-personal-managers',
	getTrainings: '/common/get-trainings',
};

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'getSurveyAnswers') return await getSurveyAnswers.call(this, itemIndex);
	if (operation === 'getScaleResults') return await getScaleResults.call(this, itemIndex);
	if (operation === 'getMailings') return await getMailings.call(this, itemIndex);
	if (operation === 'getMailingStats') return await getMailingStats.call(this, itemIndex);
	if (operation === 'getMailingContent') return await getMailingContent.call(this, itemIndex);

	const endpoint = DICTIONARIES[operation];
	if (endpoint === undefined) throw unknownOperation.call(this, 'school', operation, itemIndex);

	const data = await techApiRequest.call(this, 'GET', endpoint);

	// An account with no departments answers with an empty array. That is a result,
	// not the "nothing came back" that `toItems` reports for a write, so an empty
	// list stays empty rather than becoming one blank item.
	const rows = Array.isArray(data) ? (data as IDataObject[]) : toItems(data, {});

	return rows.map((row) => ({ json: row }));
}
