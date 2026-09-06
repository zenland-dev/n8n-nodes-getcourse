import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { toItems } from '../../helpers/request';
import { unknownOperation } from '../../../../../utils/router';
import { techApiRequest } from '../../transport';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['call'], operation: operations },
});

/**
 * Two writes into a call record, and no read anywhere.
 *
 * GetCourse names both operations «Добавить…», but its own documentation ends
 * each of them with «Повторный вызов перезаписывает значение»: each writes one
 * single-valued field, and the second call replaces what the first one put
 * there. Appending in a loop therefore keeps only the last iteration, and
 * retrying a step is harmless only because the same text is written twice.
 *
 * Read-modify-write is not really available either: the «Звонок» tag has no
 * read at all, and the only way back to the old value is `GET /deal/get-calls`,
 * which needs an order ID a workflow holding a call ID may not have.
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'addComment',
		displayOptions: { show: { resource: ['call'] } },
		options: [
			{
				name: 'Set Description (Overwrites)',
				value: 'addComment',
				action: 'Set the description of a call',
				description:
					"Повторный вызов перезаписывает значение — this replaces the call's «Описание» field outright and never appends to it. GetCourse calls the method «Добавить комментарий к звонку», which reads as though it added one.",
			},
			{
				name: 'Set Transcription (Overwrites)',
				value: 'addTranscription',
				action: 'Set the transcription of a call',
				description:
					"Повторный вызов перезаписывает значение — this replaces the call's «Транскрибация» field outright and never appends to it. A transcript sent in pieces therefore ends up as its last piece.",
			},
		],
	},
	{
		displayName:
			"Повторный вызов перезаписывает значение. Whatever stands in the call's «Описание» — including anything a manager typed there — is replaced by the text below, and the only way to read the old value first is Get Calls on the Order resource. Do not put this operation in a loop that means to append.",
		name: 'setDescriptionNotice',
		type: 'notice',
		default: '',
		displayOptions: showFor(['addComment']),
	},
	{
		displayName:
			"Повторный вызов перезаписывает значение. The call's «Транскрибация» is replaced by the text below, so a transcript assembled from several chunks has to be joined into one value before it is sent, not sent chunk by chunk.",
		name: 'setTranscriptionNotice',
		type: 'notice',
		default: '',
		displayOptions: showFor(['addTranscription']),
	},
	{
		displayName: 'Call ID',
		name: 'callId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor(['addComment', 'addTranscription']),
		description:
			'ID звонка. Nothing in the API lists calls: the ID comes from Get Calls on the Order resource, or from a call event delivered to the GetCourse Trigger node, event_object_id 8. The documentation never says whether it means the activity ID or the nested phone call ID — the activity is what carries «Описание» and «Транскрибация», so that is the one to send.',
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		required: true,
		displayOptions: showFor(['addComment', 'addTranscription']),
		description:
			'Текст, который заменит содержимое поля — «Описание» or «Транскрибация», depending on the operation. A blank value is refused here rather than sent, because the field would be emptied rather than left alone.',
	},
];

/** Which field each operation overwrites, and where. */
const TARGETS: Record<string, { endpoint: string; field: string }> = {
	addComment: { endpoint: '/call/add-comment', field: 'description' },
	addTranscription: { endpoint: '/call/add-transcription', field: 'transcription' },
};

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const target = TARGETS[operation];
	if (target === undefined) throw unknownOperation.call(this, 'call', operation, itemIndex);

	const rawCallId = String(this.getNodeParameter('callId', itemIndex, '') ?? '').trim();

	if (rawCallId === '') {
		throw new NodeOperationError(this.getNode(), 'No call named', {
			description:
				'Give the numeric call ID — Get Calls on the Order resource is where it comes from.',
			itemIndex,
		});
	}

	const text = String(this.getNodeParameter('text', itemIndex, '') ?? '');

	// The blank is stopped here rather than passed on. Both endpoints replace the
	// whole field, so an expression that happened to resolve to '' would not be a
	// no-op — it would erase a description or a transcript, with nothing left to
	// restore it from.
	if (text.trim() === '') {
		throw new NodeOperationError(this.getNode(), 'No text to write', {
			description: `Fill in Text — an empty value would clear the call's ${target.field} instead of leaving it as it is.`,
			itemIndex,
		});
	}

	const callId = Number(rawCallId);

	const data = await techApiRequest.call(this, 'POST', target.endpoint, { callId, text });

	// The answer is `{"result": true}` and nothing else, which says nothing about
	// which call it belonged to — unusable in a run over several items. The call
	// and the field that was overwritten are put in front of it.
	return toItems(data, { result: true }).map((row) => ({
		json: { callId, field: target.field, ...row },
	}));
}
