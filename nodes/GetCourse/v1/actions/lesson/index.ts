import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { returnAllProperties } from '../../descriptions/common';
import { applyLimit, toItems } from '../../helpers/request';
import { unknownOperation } from '../../../../../utils/router';
import { techApiRequest } from '../../transport';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['lesson'], operation: operations },
});

/**
 * What students write underneath a lesson, and what a curator writes back.
 *
 * One table holds two different things: a homework answer (`mission_answer`,
 * «задание») and a free comment (`free_comment`). The three operations treat
 * them alike everywhere except the status, whose legal values differ between
 * the two — which is why the read is worth running first even when the answer
 * ID is already known.
 *
 * Nothing in the Tech API lists lessons, so the lesson ID is a plain input;
 * `GET /common/get-trainings`, the nearest dictionary, stops at the training.
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getAnswers',
		displayOptions: { show: { resource: ['lesson'] } },
		options: [
			{
				name: 'Add Comment to Answer',
				value: 'addComment',
				action: 'Add a comment to a lesson answer',
				description:
					"Комментарий к ответу на урок, written on behalf of a named user. GetCourse attributes it to that person rather than to the API key, so it reads exactly like a curator's reply typed in the browser.",
			},
			{
				name: 'Get Many Answers',
				value: 'getAnswers',
				action: 'Get many answers to a lesson',
				description:
					'Ответы и комментарии к уроку, each with its own comments and additional fields. The endpoint takes no offset and returns the whole list at once, so Limit is applied after the response arrives.',
			},
			{
				name: 'Set Answer Status',
				value: 'setStatus',
				action: 'Set the status of a lesson answer',
				description:
					'Статус ответа: принят, отклонён, просмотрен или новый. Which of the four is legal depends on whether the row is a задание or a комментарий.',
			},
		],
	},
	{
		displayName: 'Lesson ID',
		name: 'lessonId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor(['getAnswers']),
		description:
			"ID урока. No method in the Tech API lists lessons — Get Many Trainings on the School resource stops at the training — so this is the number GetCourse shows in the lesson's own address in the account.",
	},
	...returnAllProperties(showFor(['getAnswers'])),
	{
		displayName: 'Answer ID',
		name: 'lessonAnswerId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor(['addComment', 'setStatus']),
		description:
			'ID ответа на урок — the ID field of a row from Get Many Answers, not the ID of the lesson itself',
	},
	{
		displayName: 'Comment Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		required: true,
		displayOptions: showFor(['addComment']),
		description: 'Текст комментария',
	},
	{
		displayName: 'Author User ID',
		name: 'authorUserId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor(['addComment']),
		description:
			'ID пользователя, от имени которого пишется комментарий. A curator or a teacher belongs here rather than the student. It stays a plain field rather than the staff dropdown the other comment operations use, because Get Many Personal Managers lists users with manager rights and a teacher need not have any — that operation is still where the ID usually comes from.',
	},
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		default: 'accepted',
		displayOptions: showFor(['setStatus']),
		options: [
			{
				name: 'Accepted (Принят)',
				value: 'accepted',
				description: 'Принят. The one value a задание and a комментарий both take.',
			},
			{
				name: 'Declined (Отклонён)',
				value: 'declined',
				description: 'Отклонён — задание only, and refused on a free comment',
			},
			{
				name: 'New (Новый)',
				value: 'new',
				description: 'Новый — back to unreviewed, which is what undoes any of the others',
			},
			{
				name: 'Viewed (Просмотрен)',
				value: 'viewed',
				description: 'Просмотрен — комментарий only, and refused on a homework answer',
			},
		],
		description:
			'Новый статус ответа. The four values are the union of two disjoint sets: для задания — new, accepted, declined; для комментария — new, accepted, viewed. GetCourse answers the wrong pairing with a 400, and the type field of a row from Get Many Answers is what says which of the two it is.',
	},
];

/** Reads a numeric ID, refusing the blank that GetCourse would answer 400 for. */
function numericId(
	this: IExecuteFunctions,
	name: string,
	itemIndex: number,
	message: string,
	description: string,
): number {
	const raw = String(this.getNodeParameter(name, itemIndex, '') ?? '').trim();

	if (raw === '') {
		throw new NodeOperationError(this.getNode(), message, { description, itemIndex });
	}

	return Number(raw);
}

/**
 * `GET /lesson/get-answers` — one lesson's whole answer table.
 *
 * Read data is passed through untouched. Three fields of `LessonAnswer` are
 * mistyped in the specification — `need_teacher_reaction` is declared with the
 * non-existent type `int`, `training_id` is an integer carrying a string
 * example, and the example for `type` is `"text"`, which is not a member of its
 * own enum — so anything this node coerced or validated here would be guesswork
 * against a document already known to be wrong about the shape.
 */
async function getAnswers(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const lessonId = numericId.call(
		this,
		'lessonId',
		itemIndex,
		'No lesson named',
		"Give the numeric lesson ID — the number in the lesson's address in the account.",
	);

	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = this.getNodeParameter('limit', itemIndex, 50) as number;

	const data = await techApiRequest.call(this, 'GET', '/lesson/get-answers', undefined, {
		lessonId,
	});

	// A lesson nobody has answered yet comes back as an empty array. That is a
	// result, not the "nothing came back" that `toItems` reports for a write, so
	// an empty list stays empty rather than becoming one blank item.
	const rows = Array.isArray(data) ? (data as IDataObject[]) : toItems(data, {});

	return applyLimit(rows, returnAll, limit).map((row) => ({ json: row }));
}

/**
 * `POST /lesson/add-comment-to-lesson-answer`.
 *
 * A call that adds one comment answers with an array of them, which is most
 * likely the answer's whole comment list after the insert; the spec never says
 * so, and gives no way to tell which entry is the new one. The array is passed
 * through as it arrives rather than reduced to a single row on a guess.
 */
async function addComment(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const lessonAnswerId = numericId.call(
		this,
		'lessonAnswerId',
		itemIndex,
		'No answer named',
		'Give the numeric answer ID from Get Many Answers.',
	);

	const userId = numericId.call(
		this,
		'authorUserId',
		itemIndex,
		'No comment author named',
		"GetCourse writes the comment on behalf of a user, so it needs that user's numeric ID.",
	);

	const text = String(this.getNodeParameter('text', itemIndex, '') ?? '');

	if (text.trim() === '') {
		throw new NodeOperationError(this.getNode(), 'The comment has no text', {
			description: 'Fill in Comment Text — GetCourse rejects an empty comment.',
			itemIndex,
		});
	}

	const data = await techApiRequest.call(this, 'POST', '/lesson/add-comment-to-lesson-answer', {
		lessonAnswerId,
		text,
		userId,
	});

	// The fallback is shaped like the `LessonAnswerComment` the endpoint would
	// have returned, so a workflow reading `comment_text` keeps working on the
	// day GetCourse answers the documented empty array instead.
	return toItems(data, {
		lesson_answer_id: lessonAnswerId,
		user_id: userId,
		comment_text: text,
	}).map((row) => ({ json: row }));
}

/**
 * Accepts either shape `/lesson/change-status-answers` may answer with.
 *
 * The spec declares its `data` as `{ items: LessonAnswer }` — an `items` key
 * with no `type: array` beside it, which OpenAPI gives no meaning to. The two
 * sibling endpoints returning the same schema both declare a plain array, so
 * the wrapper is unwrapped when it is there and the array taken when it is not,
 * rather than betting on one reading of a line the document got wrong.
 */
function answerRows(data: unknown, fallback: IDataObject): IDataObject[] {
	if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
		const wrapped = (data as IDataObject).items;
		if (wrapped !== undefined) return toItems(wrapped, fallback);
	}

	return toItems(data, fallback);
}

/** `POST /lesson/change-status-answers` — accept, decline, or mark as seen. */
async function setStatus(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const lessonAnswerId = numericId.call(
		this,
		'lessonAnswerId',
		itemIndex,
		'No answer named',
		'Give the numeric answer ID from Get Many Answers.',
	);

	const status = String(this.getNodeParameter('status', itemIndex, 'accepted'));

	const data = await techApiRequest.call(this, 'POST', '/lesson/change-status-answers', {
		lessonAnswerId,
		status,
	});

	return answerRows(data, { id: lessonAnswerId, status }).map((row) => ({ json: row }));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'addComment':
			return await addComment.call(this, itemIndex);
		case 'getAnswers':
			return await getAnswers.call(this, itemIndex);
		case 'setStatus':
			return await setStatus.call(this, itemIndex);
		default:
			throw unknownOperation.call(this, 'lesson', operation, itemIndex);
	}
}
