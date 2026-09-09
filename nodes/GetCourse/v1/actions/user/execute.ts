import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { toGetCourseDate } from '../../../../../utils/dates';
import { omitEmpty } from '../../../../../utils/query';
import { unknownOperation } from '../../../../../utils/router';
import { customFieldsPayload, toItems, userIdentifier } from '../../helpers/request';
import { techApiRequest, techApiRequestAllItems } from '../../transport';

/**
 * What a read emits.
 *
 * An empty array from a read is an empty result and has to stay empty — the
 * same shape from a write means "done", which is what `toItems`'s fallback is
 * for, and confusing the two would invent a row that GetCourse never sent.
 * `GET /user/get-fields` is the one endpoint whose `data` is `oneOf(User |
 * User[])`, so a bare object is normalised here as well.
 */
function readRows(data: unknown): INodeExecutionData[] {
	if (data === null || data === undefined) return [];
	if (Array.isArray(data) && data.length === 0) return [];

	return toItems(data, {}).map((json) => ({ json }));
}

/**
 * What a write emits.
 *
 * Three of these endpoints answer `data: []` on success. The spec types that
 * array as `array<string>`, so when something *is* in it, it is a list of soft
 * messages rather than the saved object — either way the item carries what the
 * node actually asked for, because "success: true" on its own tells a later node
 * nothing it can act on.
 */
function writeRows(data: unknown, detail: IDataObject): INodeExecutionData[] {
	if (Array.isArray(data) && data.length > 0 && data.every((entry) => typeof entry === 'string')) {
		return [{ json: { success: true, ...detail, messages: data } }];
	}

	return toItems(data, { success: true, ...detail }).map((json) => ({ json }));
}

/** Reads that take nothing beyond the user identifier. */
const IDENTIFIED_READS: Record<string, string> = {
	get: '/user/get-fields',
	getCustomFields: '/user/get-custom-fields',
	getDeals: '/user/get-deals',
	getDiplomas: '/user/get-diplomas',
	getGoals: '/user/get-goal-records',
	getGroups: '/user/get-groups',
	getLessonAnswers: '/user/get-lesson-answers',
	getSchedule: '/user/get-schedule',
	getSurveyAnswers: '/user/get-answers',
	getTrainings: '/user/get-trainings',
};

/** The three writes that share one request shape and differ only in meaning. */
const GROUP_WRITES: Record<string, string> = {
	addToGroups: '/user/add-groups',
	removeFromGroups: '/user/remove-groups',
	setGroups: '/user/set-groups',
};

/** The two paged reads, and the page size their own descriptions cap at 100. */
const PAGED_READS: Record<string, string> = {
	getDialogs: '/user/get-dialogs',
	getHelpdeskDialogs: '/user/get-helpdesk-dialogs',
};

async function getBalance(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const type = this.getNodeParameter('balanceType', itemIndex, 'virtual') as string;

	const data = await techApiRequest.call(this, 'GET', '/user/get-balance', undefined, {
		...userIdentifier.call(this, itemIndex),
		type,
	});

	return readRows(data);
}

async function getPurchases(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	// Declared `string` here while product ids are integers everywhere else in the
	// spec, so it is passed on as typed rather than coerced into a number the
	// endpoint may not be expecting.
	const productId = String(this.getNodeParameter('productId', itemIndex, '') ?? '').trim();

	const data = await techApiRequest.call(this, 'GET', '/user/get-purchases', undefined, {
		...userIdentifier.call(this, itemIndex),
		productId,
	});

	return readRows(data);
}

/**
 * The only two user reads that page at all.
 *
 * Both document a ceiling of 100 per page in prose and neither reports a total,
 * so the walk stops on the first short page. Everything else on this resource
 * answers with an unbounded array and no way to narrow it.
 */
async function getPaged(
	this: IExecuteFunctions,
	itemIndex: number,
	endpoint: string,
): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = this.getNodeParameter('limit', itemIndex, 50) as number;

	const rows = await techApiRequestAllItems.call(
		this,
		endpoint,
		userIdentifier.call(this, itemIndex),
		{ limit: returnAll ? undefined : Math.max(1, limit), pageSize: 100 },
	);

	return rows.map((json) => ({ json }));
}

/**
 * Reads the messenger chat id, which is not the user identifier trio.
 *
 * Declared `integer`, and Telegram's own ids are negative for groups, so the
 * value is sent as a number when it reads as one. Anything else goes over as
 * typed: GetCourse then names the problem, where a silent `null` would look
 * like a user who does not exist.
 */
function chatIdParameter(this: IExecuteFunctions, itemIndex: number): string | number {
	const raw = String(this.getNodeParameter('chatId', itemIndex, '') ?? '').trim();

	if (raw === '') {
		throw new NodeOperationError(this.getNode(), 'No chat named', {
			description: 'Give the numeric chat ID the messenger bot reports for this conversation.',
			itemIndex,
		});
	}

	const numeric = Number(raw);

	return Number.isFinite(numeric) ? numeric : raw;
}

async function updateUser(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const fields = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
	const clear = this.getNodeParameter('clearFields', itemIndex, []) as string[];

	const updates: IDataObject = omitEmpty({
		gender: fields.gender,
		country: fields.country,
		city: fields.city,
		first_name: fields.first_name,
		last_name: fields.last_name,
		birthday: toGetCourseDate(fields.birthday, this.getTimezone()),
		comment: fields.comment,
		phone: fields.phone,
	});

	// `null` is the only value that empties a field — an empty string would be
	// written as an empty string — and the explicit request wins over a value
	// left in the editor above.
	for (const field of clear) updates[field] = null;

	if (Object.keys(updates).length === 0) {
		throw new NodeOperationError(this.getNode(), 'Nothing to update', {
			description: 'Add at least one field to Update Fields, or name one under Fields to Clear.',
			itemIndex,
		});
	}

	const identifier = userIdentifier.call(this, itemIndex);

	// `phone` is both an identifier branch and a writable field, and the request
	// carries one `phone` key for both jobs. Sending the new number would leave
	// the server no way to find the person it belongs to.
	if (identifier.phone !== undefined && 'phone' in updates) {
		throw new NodeOperationError(
			this.getNode(),
			'A phone number cannot be both the identifier and the new value',
			{
				description:
					'Identify the user by ID or e-mail when the operation writes or clears the phone number — the request has a single phone key, so one of the two values would silently replace the other.',
				itemIndex,
			},
		);
	}

	const data = await techApiRequest.call(this, 'POST', '/user/update-fields', {
		...identifier,
		...updates,
	});

	// The response is documented as an empty array: the updated user is not
	// returned, so what the node sent is the only honest thing to report.
	return writeRows(data, { ...identifier, updated: updates });
}

async function updateCustomFields(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const customFields = customFieldsPayload.call(this, itemIndex);

	if (Object.keys(customFields).length === 0) {
		throw new NodeOperationError(this.getNode(), 'No custom fields to write', {
			description:
				"Add at least one field under Custom Fields. The picker lists the account's fields once the user above is filled in.",
			itemIndex,
		});
	}

	const data = await techApiRequest.call(this, 'POST', '/user/update-custom-fields', {
		...userIdentifier.call(this, itemIndex),
		customFields,
	});

	// This one does echo the fields back — by name, never by ID, so the echo
	// cannot be fed into a second call.
	return writeRows(data, { customFields });
}

async function writeGroups(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: string,
	endpoint: string,
): Promise<INodeExecutionData[]> {
	const supplied = this.getNodeParameter('groups', itemIndex, []) as Array<string | number>;
	const groups = supplied.map((group) => Number(group)).filter((group) => Number.isFinite(group));

	// Something was named and none of it survived — a list of group NAMES from an
	// expression, most likely, since this field wants IDs. Left alone that becomes
	// an empty array, and an empty array on Set Groups means "remove every
	// membership": a typo would silently unenrol the student from everything.
	if (supplied.length > 0 && groups.length === 0) {
		throw new NodeOperationError(this.getNode(), 'None of the groups given is an ID', {
			description:
				`Received ${JSON.stringify(supplied)}. This field takes numeric group IDs — the School ` +
				"resource's Get Many Groups operation maps names onto them. Sending nothing here would " +
				'have been read as an instruction to remove every group the user belongs to.',
			itemIndex,
		});
	}

	// An empty list is a real request for Set Groups — it strips every
	// membership, which the operation's notice says out loud — but for the other
	// two it is a call that cannot change anything.
	if (groups.length === 0 && operation !== 'setGroups') {
		throw new NodeOperationError(this.getNode(), 'No groups named', {
			description: 'Pick at least one group, or use Set Groups to clear every membership.',
			itemIndex,
		});
	}

	const identifier = userIdentifier.call(this, itemIndex);

	const data = await techApiRequest.call(this, 'POST', endpoint, { ...identifier, groups });

	// The answer is the resulting membership, which is worth more than an
	// acknowledgement — especially after Set Groups.
	return writeRows(data, { ...identifier, groups });
}

async function addBalance(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const value = this.getNodeParameter('amount', itemIndex, 0) as number;
	const type = this.getNodeParameter('addBalanceType', itemIndex, 'virtual') as string;
	const comment = String(this.getNodeParameter('balanceComment', itemIndex, '') ?? '');

	const data = await techApiRequest.call(this, 'POST', '/user/add-balance', {
		...userIdentifier.call(this, itemIndex),
		value,
		// The spec declares `type` an integer and then enumerates it with the
		// strings "virtual" and "points". The enum is the half that describes real
		// traffic, so a string is what goes on the wire.
		type,
		// `comment` sits in the schema's `required` list while its own description
		// says the account fills one in when it is blank, so the key is always
		// present even when it is empty.
		comment,
	});

	return writeRows(data, { value, type });
}

async function setPersonalManager(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const raw = this.getNodeParameter('managerId', itemIndex, '') as string | number;
	const managerId = String(raw ?? '').trim();

	const identifier = userIdentifier.call(this, itemIndex);

	// An unparseable ID must not be sent. `Number('Иванов')` is NaN, JSON turns
	// that into null, and null here is indistinguishable from the empty string the
	// API reads as "remove the personal manager" — so a typo would quietly strip
	// the manager instead of assigning one.
	if (managerId !== '' && !Number.isFinite(Number(managerId))) {
		throw new NodeOperationError(this.getNode(), `"${managerId}" is not a manager ID`, {
			description:
				'Pick a manager from the list, or give a numeric ID. Leave the field empty to remove the personal manager — a value that is neither is refused, because it would reach GetCourse as a removal.',
			itemIndex,
		});
	}

	// The schema puts `managerId` in `required` and its description says to send
	// it empty to remove the manager — a contradiction only the server can settle.
	// The node follows the description, because that is the half that documents
	// behaviour: an empty string for a removal, a number otherwise.
	const data = await techApiRequest.call(this, 'POST', '/user/set-personal-manager', {
		...identifier,
		managerId: managerId === '' ? '' : Number(managerId),
	});

	// Documented as an empty array, so the removal or assignment is reported here.
	return writeRows(data, {
		...identifier,
		managerId: managerId === '' ? null : Number(managerId),
		removed: managerId === '',
	});
}

async function createDiploma(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const templateId = String(this.getNodeParameter('templateId', itemIndex, '') ?? '').trim();

	if (templateId === '') {
		throw new NodeOperationError(this.getNode(), 'No diploma template named', {
			description:
				'Give the numeric template ID. Nothing in the Tech API lists templates, so it has to be read from the account.',
			itemIndex,
		});
	}

	const fields = this.getNodeParameter('diplomaFields', itemIndex, {}) as IDataObject;

	const body: IDataObject = {
		...userIdentifier.call(this, itemIndex),
		templateId: Number(templateId),
		...omitEmpty({
			number: fields.number,
			trainingName: fields.trainingName,
			userName: fields.userName,
		}),
	};

	// Both booleans have server-side defaults — no duplicates, notify — so they
	// are sent only when the editor carries them, leaving GetCourse in charge of
	// the case where the workflow said nothing.
	if (fields.allowDuplicates !== undefined) body.allowDuplicates = fields.allowDuplicates === true;
	if (fields.sendNotify !== undefined) body.sendNotify = fields.sendNotify === true;

	const data = await techApiRequest.call(this, 'POST', '/user/create-diploma', body);

	return writeRows(data, { templateId: Number(templateId) });
}

async function addComment(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const userId = String(this.getNodeParameter('commentUserId', itemIndex, '') ?? '').trim();
	const authorId = String(this.getNodeParameter('authorId', itemIndex, '') ?? '').trim();
	const text = String(this.getNodeParameter('text', itemIndex, '') ?? '');

	// All three are required and none of them has an identifier branch, so the
	// usual "name the user however you like" plumbing does not apply here.
	if (userId === '' || authorId === '' || text === '') {
		throw new NodeOperationError(this.getNode(), 'A comment needs a user, an author and text', {
			description:
				'This endpoint takes numeric IDs only — no e-mail and no phone number. The author is the employee the comment is written as, and Get Many Personal Managers on the School resource lists the IDs.',
			itemIndex,
		});
	}

	const data = await techApiRequest.call(this, 'POST', '/user/add-comment', {
		userId: Number(userId),
		authorId: Number(authorId),
		text,
	});

	// The payload is a bare `{ result: true }`, which says nothing about what was
	// written; the ids are carried alongside so a later node can act on it.
	return writeRows(data, { userId: Number(userId), authorId: Number(authorId) });
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const read = IDENTIFIED_READS[operation];
	if (read !== undefined) {
		const data = await techApiRequest.call(
			this,
			'GET',
			read,
			undefined,
			userIdentifier.call(this, itemIndex),
		);

		return readRows(data);
	}

	const paged = PAGED_READS[operation];
	if (paged !== undefined) return await getPaged.call(this, itemIndex, paged);

	const groupWrite = GROUP_WRITES[operation];
	if (groupWrite !== undefined) {
		return await writeGroups.call(this, itemIndex, operation, groupWrite);
	}

	switch (operation) {
		case 'getBalance':
			return await getBalance.call(this, itemIndex);
		case 'getPurchases':
			return await getPurchases.call(this, itemIndex);
		case 'getByChatId': {
			const data = await techApiRequest.call(this, 'GET', '/user/get-user-by-chat-id', undefined, {
				messengerType: this.getNodeParameter('messengerType', itemIndex, 'tg') as string,
				chatId: chatIdParameter.call(this, itemIndex),
			});

			return readRows(data);
		}
		case 'getByTelegramChatId': {
			const data = await techApiRequest.call(
				this,
				'GET',
				'/user/get-user-by-telegram-chat-id',
				undefined,
				{ chatId: chatIdParameter.call(this, itemIndex) },
			);

			return readRows(data);
		}
		case 'update':
			return await updateUser.call(this, itemIndex);
		case 'updateCustomFields':
			return await updateCustomFields.call(this, itemIndex);
		case 'addBalance':
			return await addBalance.call(this, itemIndex);
		case 'setPersonalManager':
			return await setPersonalManager.call(this, itemIndex);
		case 'createDiploma':
			return await createDiploma.call(this, itemIndex);
		case 'addComment':
			return await addComment.call(this, itemIndex);
		default:
			throw unknownOperation.call(this, 'user', operation, itemIndex);
	}
}
