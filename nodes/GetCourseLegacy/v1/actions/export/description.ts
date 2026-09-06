import type { INodeProperties } from 'n8n-workflow';

import {
	DEAL_STATUSES_FOR_EXPORT,
	PAYMENT_STATUSES,
	USER_STATUSES,
} from '../../descriptions/constants';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['export'], operation: operations },
});

/** The two operations that start a job and therefore need a dataset and filters. */
const STARTING = ['start', 'run'];

const forDataset = (
	datasets: string[],
	operations: string[] = STARTING,
): INodeProperties['displayOptions'] => ({
	show: { resource: ['export'], operation: operations, dataset: datasets },
});

/**
 * Four operations over a two-step API, so that the same job can be one node or
 * a chain of them.
 *
 * GetCourse builds an export asynchronously: one request starts it and returns
 * an ID, and a second request either says "not ready" or hands over the whole
 * table. «Export and Wait» does both with a poll loop in between, which is what
 * most workflows want. The other three expose the same steps separately, for
 * when the wait belongs in the workflow — an n8n Wait node between Start and Get
 * Result survives a restart and costs no execution time, and a long export can
 * be picked up by a later run from its ID alone.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'run',
	displayOptions: { show: { resource: ['export'] } },
	options: [
		{
			name: 'Export and Wait',
			value: 'run',
			action: 'Export data and wait for it',
			description:
				'Выгрузка целиком: старт, ожидание и получение данных одним узлом. Starts the job, polls until GetCourse has built the file, and returns the rows.',
		},
		{
			name: 'Start',
			value: 'start',
			action: 'Start an export',
			description:
				'Шаг 1: запустить выгрузку. Returns the export ID and nothing else — the data is fetched by a later Get Result.',
		},
		{
			name: 'Check Status',
			value: 'checkStatus',
			action: 'Check whether an export is ready',
			description:
				'Шаг 2: узнать, готова ли выгрузка. Returns a ready flag, the column list and the row count, without the rows themselves.',
		},
		{
			name: 'Get Result',
			value: 'getResult',
			action: 'Get the result of an export',
			description:
				'Шаг 3: забрать данные готовой выгрузки. Answers with the rows, or reports that the file is still being built.',
		},
	],
};

const budgetNotice: INodeProperties = {
	displayName:
		'На аккаунт приходится 100 запросов Export API за 2 часа, и проверка готовности тоже считается. GetCourse builds one export at a time per account and does not queue a second — a request made while another is still building is refused outright. That catches two of these running side by side, and it equally catches one «Start» fed several input items: the first takes the lock and every item after it is refused. Give this node a single item, loop the items through a Wait node, or use «Export and Wait», which finishes each export before beginning the next. Because Check Status and Get Result are the same request underneath, a three-node chain costs one request more per loop than Get Result alone with «On Not Ready» set to «Return Status».',
	name: 'exportBudgetNotice',
	type: 'notice',
	default: '',
	displayOptions: { show: { resource: ['export'] } },
};

const dataset: INodeProperties = {
	displayName: 'Dataset',
	name: 'dataset',
	type: 'options',
	noDataExpression: true,
	default: 'users',
	displayOptions: showFor(STARTING),
	options: [
		{
			name: 'Group Members',
			value: 'groupUsers',
			description:
				'Пользователи одной группы, with the group ID and the join date added to every row',
		},
		{
			name: 'Orders',
			value: 'deals',
			description: 'Заказы аккаунта, about seventy columns wide',
		},
		{
			name: 'Payments',
			value: 'payments',
			description: 'Платежи аккаунта',
		},
		{
			name: 'Users',
			value: 'users',
			description: 'Пользователи аккаунта, including every custom user field',
		},
	],
	description:
		"Что выгружать. The columns match what the account's own CSV export produces for that section, custom fields included.",
};

const groupProperty: INodeProperties = {
	displayName: 'Group Name or ID',
	name: 'groupId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getGroups' },
	default: '',
	required: true,
	displayOptions: forDataset(['groupUsers']),
	description:
		'Группа, чьих участников выгружаем. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const filterNotice: INodeProperties = {
	displayName:
		'Нужен хотя бы один фильтр — без него GetCourse отвечает «Должен быть передан хотя бы один фильтр». Filters are combined with AND, and a date is sent as a whole day worked out in the WORKFLOW timezone, which is not necessarily the one the account keeps: a school in another zone can see the boundary fall a few hours out. A range wider than a few weeks can produce a response of tens of megabytes, so split long periods into several runs.',
	name: 'exportFilterNotice',
	type: 'notice',
	default: '',
	displayOptions: showFor(STARTING),
};

/**
 * Every dataset gets its own collection, under its own parameter name.
 *
 * The obvious alternative — one `filters` collection shown for whichever dataset
 * is chosen — shares one piece of storage between four different filter
 * vocabularies. Choose Users, set Status to «Активные», switch to Orders, and
 * `status: "active"` is still there: invisible in the interface, and sent to an
 * endpoint whose statuses are `new`, `payed` and the rest. The same trick sends
 * a group join date with a plain user export. Separate names make that
 * impossible rather than merely unlikely.
 */
const userFilters: INodeProperties = {
	displayName: 'Filters',
	name: 'userFilters',
	type: 'collection',
	placeholder: 'Add Filter',
	default: {},
	displayOptions: forDataset(['users']),
	options: [
		{
			displayName: 'Created From',
			name: 'createdFrom',
			type: 'dateTime',
			default: '',
			description: 'Дата регистрации пользователя, начиная с этого дня',
		},
		{
			displayName: 'Created To',
			name: 'createdTo',
			type: 'dateTime',
			default: '',
			description: 'Дата регистрации пользователя, по этот день включительно',
		},
		{
			displayName: 'Emails',
			name: 'email',
			type: 'string',
			default: '',
			placeholder: 'one@example.com, two@example.com',
			description: 'Электронные адреса, comma-separated',
		},
		{
			displayName: 'Status',
			name: 'status',
			type: 'options',
			default: 'active',
			options: USER_STATUSES,
			description: 'Статус пользователя',
		},
	],
};

/**
 * The group export takes three filters and not the e-mail one.
 *
 * GetCourse documents `created_at`, `status` and `added_at` for
 * `/pl/api/account/groups/{id}/users`, and `email` only for the plain user
 * export — so offering it here would be offering a filter that does nothing.
 */
const groupUserFilters: INodeProperties = {
	displayName: 'Filters',
	name: 'groupUserFilters',
	type: 'collection',
	placeholder: 'Add Filter',
	default: {},
	displayOptions: forDataset(['groupUsers']),
	options: [
		{
			displayName: 'Added to Group From',
			name: 'addedFrom',
			type: 'dateTime',
			default: '',
			description: 'Дата добавления в группу, начиная с этого дня',
		},
		{
			displayName: 'Added to Group To',
			name: 'addedTo',
			type: 'dateTime',
			default: '',
			description: 'Дата добавления в группу, по этот день включительно',
		},
		{
			displayName: 'Created From',
			name: 'createdFrom',
			type: 'dateTime',
			default: '',
			description: 'Дата регистрации пользователя, начиная с этого дня',
		},
		{
			displayName: 'Created To',
			name: 'createdTo',
			type: 'dateTime',
			default: '',
			description: 'Дата регистрации пользователя, по этот день включительно',
		},
		{
			displayName: 'Status',
			name: 'status',
			type: 'options',
			default: 'active',
			options: USER_STATUSES,
			description: 'Статус пользователя',
		},
	],
};

const dealFilters: INodeProperties = {
	displayName: 'Filters',
	name: 'dealFilters',
	type: 'collection',
	placeholder: 'Add Filter',
	default: {},
	displayOptions: forDataset(['deals']),
	options: [
		{
			displayName: 'Created From',
			name: 'createdFrom',
			type: 'dateTime',
			default: '',
			description: 'Дата создания заказа, начиная с этого дня',
		},
		{
			displayName: 'Created To',
			name: 'createdTo',
			type: 'dateTime',
			default: '',
			description: 'Дата создания заказа, по этот день включительно',
		},
		{
			displayName: 'Finished From',
			name: 'finishedFrom',
			type: 'dateTime',
			default: '',
			description: 'Дата завершения заказа, начиная с',
		},
		{
			displayName: 'Finished To',
			name: 'finishedTo',
			type: 'dateTime',
			default: '',
			description: 'Дата завершения заказа, по',
		},
		{
			displayName: 'In Group Name or ID',
			name: 'user_in_group',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getGroups' },
			default: '',
			description:
				'Только заказы пользователей этой группы. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		},
		{
			displayName: 'Paid From',
			name: 'payedFrom',
			type: 'dateTime',
			default: '',
			description: 'Дата оплаты заказа, начиная с',
		},
		{
			displayName: 'Paid To',
			name: 'payedTo',
			type: 'dateTime',
			default: '',
			description: 'Дата оплаты заказа, по',
		},
		{
			displayName: 'Status',
			name: 'status',
			type: 'options',
			default: 'payed',
			options: DEAL_STATUSES_FOR_EXPORT,
			description:
				'Статус заказа. The export filter takes nine of the ten statuses — «Ложный» is not among them.',
		},
		{
			displayName: 'Status Changed From',
			name: 'statusChangedFrom',
			type: 'dateTime',
			default: '',
			description: 'Дата изменения статуса, начиная с',
		},
		{
			displayName: 'Status Changed To',
			name: 'statusChangedTo',
			type: 'dateTime',
			default: '',
			description: 'Дата изменения статуса, по',
		},
		{
			displayName: 'User IDs',
			name: 'user_id',
			type: 'string',
			default: '',
			placeholder: '1234567, 2345678',
			description: 'ID пользователей, comma-separated',
		},
	],
};

const paymentFilters: INodeProperties = {
	displayName: 'Filters',
	name: 'paymentFilters',
	type: 'collection',
	placeholder: 'Add Filter',
	default: {},
	displayOptions: forDataset(['payments']),
	options: [
		{
			displayName: 'Created From',
			name: 'createdFrom',
			type: 'dateTime',
			default: '',
			description: 'Дата создания платежа, начиная с этого дня',
		},
		{
			displayName: 'Created To',
			name: 'createdTo',
			type: 'dateTime',
			default: '',
			description: 'Дата создания платежа, по этот день включительно',
		},
		{
			displayName: 'Status',
			name: 'status',
			type: 'options',
			default: 'accepted',
			options: PAYMENT_STATUSES,
			description: 'Статус платежа',
		},
		{
			displayName: 'Status Changed From',
			name: 'statusChangedFrom',
			type: 'dateTime',
			default: '',
			description: 'Дата изменения статуса платежа, начиная с',
		},
		{
			displayName: 'Status Changed To',
			name: 'statusChangedTo',
			type: 'dateTime',
			default: '',
			description: 'Дата изменения статуса платежа, по',
		},
	],
};

const groupColumnsProperty: INodeProperties = {
	displayName: 'Group Columns',
	name: 'idgrouplist',
	type: 'options',
	default: '',
	displayOptions: forDataset(['users']),
	options: [
		{ name: 'None', value: '', description: 'Do not add group columns' },
		{ name: 'Group IDs', value: 'id', description: 'Каждая группа пользователя одним столбцом ID' },
		{
			name: 'Group IDs With Join Dates',
			value: 'id_date',
			description: 'То же плюс даты, in the form «ID группы: ГГГГ-ММ-ДД»',
		},
	],
	description:
		'Добавить в выгрузку группы пользователя. This is not a filter, so an export still needs one of the filters above.',
};

const exportIdProperty: INodeProperties = {
	displayName: 'Export ID',
	name: 'exportId',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['checkStatus', 'getResult']),
	description:
		'Ключ экспорта, returned by Start. It stays valid after the workflow that created it has finished, so a long export can be picked up by a later run.',
};

const pollOptions: INodeProperties = {
	displayName: 'Waiting',
	name: 'polling',
	type: 'collection',
	placeholder: 'Add Setting',
	default: {},
	displayOptions: showFor(['run']),
	description: 'Как долго ждать готовности файла',
	options: [
		{
			displayName: 'Give Up After',
			name: 'maxPolls',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 60 },
			default: 10,
			description:
				"Сколько раз проверить готовность. Each check spends one of the account's hundred requests, so ten checks plus the start is eleven — about nine exports per two-hour window.",
		},
		{
			displayName: 'On Timeout',
			name: 'onTimeout',
			type: 'options',
			default: 'error',
			options: [
				{
					name: 'Fail',
					value: 'error',
					description: 'Stop the workflow and name the export ID in the message',
				},
				{
					name: 'Return the Export ID',
					value: 'returnId',
					description:
						'Emit the ID and carry on, so a later Get Result can pick the finished file up',
				},
			],
			description: 'Что делать, если файл так и не собрался',
		},
		{
			displayName: 'Poll Every',
			name: 'pollInterval',
			type: 'number',
			typeOptions: { minValue: 5, maxValue: 600 },
			default: 30,
			description:
				'Пауза между проверками, in seconds. Below about 20 seconds the checks cost more budget than they save time.',
		},
		{
			displayName: 'Wait Before First Check',
			name: 'initialDelay',
			type: 'number',
			typeOptions: { minValue: 0, maxValue: 600 },
			default: 15,
			description:
				'Пауза перед первой проверкой, in seconds. An export is never instant, so checking immediately just spends a request.',
		},
	],
};

const notReadyProperty: INodeProperties = {
	displayName: 'On Not Ready',
	name: 'onNotReady',
	type: 'options',
	default: 'error',
	displayOptions: showFor(['getResult']),
	options: [
		{
			name: 'Fail',
			value: 'error',
			description: 'Stop with an error saying the file is still being built',
		},
		{
			name: 'Return Status',
			value: 'status',
			description:
				'Emit {ready: false, export_id} instead, so an IF node can loop back through a Wait',
		},
	],
	description:
		'Что делать, если файл ещё собирается. Returning the status is what makes a Start → Wait → Get Result loop possible without a separate Check Status request.',
};

const outputOptions: INodeProperties = {
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add Option',
	default: {},
	displayOptions: showFor(['run', 'getResult']),
	options: [
		{
			displayName: 'Column Names',
			name: 'keyStyle',
			type: 'options',
			default: 'original',
			options: [
				{
					name: 'As GetCourse Sends Them',
					value: 'original',
					description: 'Заголовки аккаунта, e.g. «Создан» или «ID партнера»',
				},
				{
					name: 'Transliterated',
					value: 'slug',
					description: 'Латиницей в нижнем регистре, e.g. sozdan',
				},
			],
			description:
				'Как называть поля. Most GetCourse columns are named in Russian, which is awkward to reference in an expression, though some arrive in Latin already — utm_source, VK-ID — and transliteration leaves those alone. It trades exactness for a key you can type.',
		},
		{
			displayName: 'Output',
			name: 'output',
			type: 'options',
			default: 'rows',
			options: [
				{
					name: 'One Item per Row',
					value: 'rows',
					description: 'Каждая строка выгрузки — отдельный item',
				},
				{
					name: 'Single Item',
					value: 'raw',
					description: 'Весь ответ одним item, with the fields and items arrays untouched',
				},
			],
			description:
				'Форма результата. GetCourse answers with a column list and an array of arrays; the default zips them into objects.',
		},
	],
};

export const description: INodeProperties[] = [
	operation,
	budgetNotice,
	dataset,
	groupProperty,
	filterNotice,
	userFilters,
	groupUserFilters,
	dealFilters,
	paymentFilters,
	groupColumnsProperty,
	exportIdProperty,
	notReadyProperty,
	pollOptions,
	outputOptions,
];
