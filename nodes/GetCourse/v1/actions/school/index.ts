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
import { techApiRequest } from '../../transport';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['school'], operation: operations },
});

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
	...returnAllProperties(showFor(['getSurveyAnswers'])),
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

	const endpoint = DICTIONARIES[operation];
	if (endpoint === undefined) throw unknownOperation.call(this, 'school', operation, itemIndex);

	const data = await techApiRequest.call(this, 'GET', endpoint);

	// An account with no departments answers with an empty array. That is a result,
	// not the "nothing came back" that `toItems` reports for a write, so an empty
	// list stays empty rather than becoming one blank item.
	const rows = Array.isArray(data) ? (data as IDataObject[]) : toItems(data, {});

	return rows.map((row) => ({ json: row }));
}
