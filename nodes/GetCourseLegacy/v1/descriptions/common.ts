import type { INodeProperties } from 'n8n-workflow';

/** The sentence n8n's linter requires on every dropdown backed by a load method. */
export const DYNAMIC_OPTIONS_DESCRIPTION =
	'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>';

/** The same sentence for a multi-select. */
export const DYNAMIC_MULTI_OPTIONS_DESCRIPTION =
	'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>';

/**
 * The user block, shared by the user import and the order import.
 *
 * GetCourse identifies a person by e-mail — every import call carries a `user`
 * object, and an order import creates the person if they are new. So the same
 * fields appear under both resources, and this builds them once.
 */
export function userIdentityProperties(
	displayOptions: INodeProperties['displayOptions'],
	options: { emailDescription?: string } = {},
): INodeProperties[] {
	return [
		{
			displayName: 'Email',
			name: 'email',
			type: 'string',
			placeholder: 'name@example.com',
			default: '',
			displayOptions,
			description:
				options.emailDescription ??
				'Электронная почта пользователя. This is what GetCourse matches on: an address it already knows updates that person, a new one creates them. Either this or Phone is required.',
		},
		{
			displayName: 'Phone',
			name: 'phone',
			type: 'string',
			default: '',
			placeholder: '+79161234567',
			displayOptions,
			description:
				'Телефон пользователя. Accepted instead of Email when the address is unknown, though matching on it is less reliable — GetCourse normalises numbers before comparing.',
		},
	];
}

/** Everything else GetCourse stores on a person, as an optional collection. */
export function userProfileFields(): INodeProperties[] {
	return [
		{
			displayName: 'City',
			name: 'city',
			type: 'string',
			default: '',
			description: 'Город пользователя',
		},
		{
			displayName: 'Country',
			name: 'country',
			type: 'string',
			default: '',
			placeholder: 'Россия',
			description: 'Страна пользователя, in words rather than as an ISO code',
		},
		{
			displayName: 'First Name',
			name: 'first_name',
			type: 'string',
			default: '',
			description: 'Имя пользователя',
		},
		{
			displayName: 'Last Name',
			name: 'last_name',
			type: 'string',
			default: '',
			description: 'Фамилия пользователя',
		},
	];
}

/**
 * Groups to put the person in.
 *
 * The second field exists because GetCourse accepts either a bare group name or
 * a `["Группа", "2018-08-01 21:21"]` pair that backdates the membership — which
 * is the only way to import a history of when people joined.
 */
export function groupsProperty(
	displayOptions: INodeProperties['displayOptions'],
	options: { includeAddedAt?: boolean; description?: string } = {},
): INodeProperties {
	const values: INodeProperties[] = [
		{
			displayName: 'Group Name or ID',
			name: 'name',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getGroupNames' },
			default: '',
			description:
				'Группа. What travels to GetCourse is the group NAME, not its ID — that is what the import API reads. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		},
	];

	// Offered only where it is honoured. `action=update` takes a flat list of names
	// and ignores the dated form entirely, so showing the picker there would be a
	// field that promises a join date and quietly throws it away.
	if (options.includeAddedAt !== false) {
		values.push({
			displayName: 'Added At',
			name: 'addedAt',
			type: 'dateTime',
			default: '',
			description:
				'Дата добавления в группу. Leave empty to use the moment of the request. Sent as YYYY-MM-DD HH:MM:SS in the workflow timezone.',
		});
	}

	return {
		displayName: 'Groups',
		name: 'groupsUi',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Group',
		default: {},
		displayOptions,
		description:
			options.description ??
			'Группы пользователя. Named by title, not by ID. On an import these are added to whatever groups the person is already in.',
		options: [
			{
				name: 'entry',
				displayName: 'Group',
				values,
			},
		],
	};
}

/**
 * The custom-field editor.
 *
 * GetCourse's `addfields` object is keyed by the field's NAME, not its ID, which
 * is unusual enough to be worth a dropdown: the names have to match the account
 * exactly, spaces and capitalisation included, and a typo is silently ignored
 * rather than rejected.
 */
export function addFieldsProperty(
	displayOptions: INodeProperties['displayOptions'],
	loadOptionsMethod: string,
	subject: string,
): INodeProperties {
	return {
		displayName: 'Custom Fields',
		name: 'addFieldsUi',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Custom Field',
		default: {},
		displayOptions,
		description: `Дополнительные поля ${subject}. Values for the custom fields configured in the account.`,
		options: [
			{
				name: 'field',
				displayName: 'Field',
				values: [
					{
						displayName: 'Field Name or ID',
						name: 'name',
						type: 'options',
						typeOptions: { loadOptionsMethod },
						default: '',
						required: true,
						description:
							'Дополнительное поле. GetCourse addresses custom fields by their exact name, spaces and capitalisation included, so a mistyped one is dropped silently rather than reported. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						description:
							'Значение поля. Everything is sent as text: a date as YYYY-MM-DD, a checkbox as 1 or 0, and a select as the option label exactly as it reads in the account.',
					},
				],
			},
		],
	};
}

/**
 * The `session` object: where this person or order came from.
 *
 * GetCourse records these once, as the registration context of a new user or the
 * creation context of an order. On an update they are rewritten for the order
 * but not for the user, which is the sort of asymmetry worth stating in the UI.
 */
export function sessionProperty(
	displayOptions: INodeProperties['displayOptions'],
): INodeProperties {
	return {
		displayName: 'Traffic Source',
		name: 'session',
		type: 'collection',
		placeholder: 'Add Parameter',
		default: {},
		displayOptions,
		description:
			'Параметры сессии. UTM tags and partner markers, recorded as the context in which the object was created.',
		options: [
			{
				displayName: 'Gcao',
				name: 'gcao',
				type: 'string',
				default: '',
				description: 'Метка gcao — the affiliate-offer marker GetCourse sets itself',
			},
			{
				displayName: 'Gcpc',
				name: 'gcpc',
				type: 'string',
				default: '',
				description:
					'Метка партнёра gcpc. Takes precedence over Partner Email when both name a partner.',
			},
			{
				displayName: 'Referer',
				name: 'referer',
				type: 'string',
				default: '',
				description:
					'Страница, с которой пришёл посетитель. Accepted by the platform SDK but missing from the help page, so treat it as best-effort.',
			},
			{ displayName: 'UTM Campaign', name: 'utm_campaign', type: 'string', default: '' },
			{ displayName: 'UTM Content', name: 'utm_content', type: 'string', default: '' },
			{ displayName: 'UTM Group', name: 'utm_group', type: 'string', default: '' },
			{ displayName: 'UTM Medium', name: 'utm_medium', type: 'string', default: '' },
			{ displayName: 'UTM Source', name: 'utm_source', type: 'string', default: '' },
			{
				displayName: 'UTM Term',
				name: 'utm_term',
				type: 'string',
				default: '',
				description:
					'Метка utm_term. In the platform SDK but not on the help page, unlike the other five UTM tags.',
			},
		],
	};
}

/** The notice every import resource carries, because the platform insists on it. */
export function importNotice(
	name: string,
	displayOptions: INodeProperties['displayOptions'],
): INodeProperties {
	return {
		displayName:
			'GetCourse calls this an import, not an API for day-to-day changes, and meters it: creating objects counts against a monthly allowance that depends on the account plan, while updating them does not. For anything that has to react within seconds, a process with the «Вызвать URL» operation pointed at a Webhook node is the intended route.',
		name,
		type: 'notice',
		default: '',
		displayOptions,
	};
}
