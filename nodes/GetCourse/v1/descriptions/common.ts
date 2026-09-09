import type { INodeProperties } from 'n8n-workflow';

/** The sentence n8n's linter requires on every dropdown backed by a load method. */
export const DYNAMIC_OPTIONS_DESCRIPTION =
	'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>';

/** The same sentence for a multi-select. */
export const DYNAMIC_MULTI_OPTIONS_DESCRIPTION =
	'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>';

const show = (
	resource: string,
	operations: string[],
	extra: Record<string, unknown> = {},
): INodeProperties['displayOptions'] => ({
	show: { resource: [resource], operation: operations, ...extra },
});

/**
 * How the Tech API names a person.
 *
 * Nearly every user endpoint takes one of `userId`, `email` or `phone` rather
 * than a plain id, and the platform's own descriptions spell out the order of
 * preference: the ID if you have it, the e-mail if you do not, the phone number
 * as a last resort. Presenting that as a selector rather than three optional
 * boxes matters, because sending two of them at once leaves it to the server to
 * decide which one wins — and it does not document that choice.
 *
 * All three really are accepted everywhere, which only `get-fields` documents.
 * A live account settles it twice over: an endpoint called with no identifier at
 * all answers «Необходимо указать userId, email или телефон», naming the phone
 * itself; and called with a phone matching nobody it answers «Объект не найден»,
 * a different error, so the parameter was read rather than ignored. Fourteen
 * user endpoints were checked and none behaved differently.
 */
export function userIdentifierProperties(
	resource: string,
	operations: string[],
): INodeProperties[] {
	return [
		{
			displayName: 'Identify User By',
			name: 'identifyBy',
			type: 'options',
			default: 'userId',
			displayOptions: show(resource, operations),
			options: [
				{
					name: 'User ID',
					value: 'userId',
					description: 'ID пользователя — unambiguous, and the only form every endpoint accepts',
				},
				{
					name: 'Email',
					value: 'email',
					description: 'Email пользователя, when the ID is unknown',
				},
				{
					name: 'Phone',
					value: 'phone',
					description:
						'Телефон пользователя. Documented for the write endpoints and for Get; the other reads may ignore it and answer as if no user was named.',
				},
			],
			description: 'Чем адресуем пользователя. Exactly one of the three is sent.',
		},
		{
			displayName: 'User ID',
			name: 'userId',
			type: 'string',
			default: '',
			required: true,
			displayOptions: show(resource, operations, { identifyBy: ['userId'] }),
			description: 'ID пользователя в GetCourse',
		},
		{
			displayName: 'Email',
			name: 'email',
			type: 'string',
			placeholder: 'name@example.com',
			default: '',
			required: true,
			displayOptions: show(resource, operations, { identifyBy: ['email'] }),
			description: 'Электронная почта пользователя',
		},
		{
			displayName: 'Phone',
			name: 'phone',
			type: 'string',
			placeholder: '+79161234567',
			default: '',
			required: true,
			displayOptions: show(resource, operations, { identifyBy: ['phone'] }),
			description: 'Телефон пользователя, in international form',
		},
	];
}

/** The order id, which the deal endpoints take as a plain number. */
export function dealIdProperty(
	resource: string,
	operations: string[],
	description = 'ID заказа в GetCourse',
): INodeProperties {
	return {
		displayName: 'Order ID',
		name: 'dealId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: show(resource, operations),
		description,
	};
}

/**
 * "Return All" plus the limit that appears when it is off.
 *
 * The wording of both is fixed by n8n's linter, which compares the description
 * against a literal string — no Russian gloss is possible on these two.
 */
export function returnAllProperties(
	displayOptions: INodeProperties['displayOptions'],
): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			displayOptions,
			description: 'Whether to return all results or only up to a given limit',
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			typeOptions: { minValue: 1 },
			default: 50,
			displayOptions: {
				...displayOptions,
				show: { ...displayOptions?.show, returnAll: [false] },
			},
			description: 'Max number of results to return',
		},
	];
}

/**
 * The custom-field editor for the Tech API.
 *
 * The Tech API writes custom fields by numeric ID and publishes no account-wide
 * dictionary of those IDs, so this was a bare number-and-value editor at first.
 * The picker that replaced it reads the account's whole dictionary from the
 * legacy API, which both nodes can now reach because they share one credential.
 *
 * It deliberately depends on nothing else on the panel. The first version read
 * the list from the user or the order the operation names, and that was a
 * mistake worth naming: a control whose job is to help fill the form refused to
 * open until the form was already filled, and an identifier written as an
 * expression — the normal case in a workflow — cannot resolve while the editor
 * is merely open, so the picker failed on nodes that were configured correctly.
 *
 * The field stays an `options` type rather than a `resourceLocator`, so an ID
 * can still be supplied by expression when the workflow computes it.
 */
export function customFieldsProperty(resource: string, operations: string[]): INodeProperties {
	const isUser = resource === 'user';

	return {
		displayName: 'Custom Fields',
		name: 'customFieldsUi',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Custom Field',
		default: {},
		displayOptions: show(resource, operations),
		description: `Дополнительные поля, keyed by numeric field ID. The list holds every ${isUser ? 'user' : 'order'} field the account defines, read from the account itself rather than from any one ${isUser ? 'person' : 'order'}.`,
		options: [
			{
				name: 'field',
				displayName: 'Field',
				values: [
					{
						displayName: 'Field Name or ID',
						name: 'id',
						type: 'options',
						typeOptions: {
							loadOptionsMethod: isUser ? 'getUserCustomFieldIds' : 'getDealCustomFieldIds',
						},
						default: '',
						required: true,
						description: `Дополнительное поле аккаунта. ${DYNAMIC_OPTIONS_DESCRIPTION}.`,
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						description: 'Значение поля',
					},
				],
			},
		],
	};
}
