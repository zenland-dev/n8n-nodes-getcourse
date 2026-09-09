import type { INodeProperties } from 'n8n-workflow';

import {
	customFieldsProperty,
	returnAllProperties,
	userIdentifierProperties,
} from '../../descriptions/common';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['user'], operation: operations },
});

/**
 * Everything except three operations names the person with the same trio.
 *
 * `getByChatId` and `getByTelegramChatId` look a user up from the other end — by
 * a messenger conversation rather than by anything on the user card — and
 * `addComment` is one of the two endpoints in the whole API that insist on a
 * bare numeric ID, so none of the three belongs in this list.
 */
const IDENTIFIED = [
	'addBalance',
	'addToGroups',
	'createDiploma',
	'get',
	'getBalance',
	'getCustomFields',
	'getDeals',
	'getDialogs',
	'getDiplomas',
	'getGoals',
	'getGroups',
	'getHelpdeskDialogs',
	'getLessonAnswers',
	'getPurchases',
	'getSchedule',
	'getSurveyAnswers',
	'getTrainings',
	'removeFromGroups',
	'setGroups',
	'setPersonalManager',
	'update',
	'updateCustomFields',
];

/** The two reads that page; every other list here arrives whole and unbounded. */
const PAGED = ['getDialogs', 'getHelpdeskDialogs'];

const GROUP_WRITES = ['addToGroups', 'removeFromGroups', 'setGroups'];

/**
 * The Tech API's largest surface, and its most one-sided.
 *
 * Twenty-five operations, none of which can create or delete a person: the Tech
 * API only reads and edits users that already exist. Creating one is the legacy
 * Import API's job, which is what the GetCourse Legacy node's User resource
 * covers.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'get',
	displayOptions: { show: { resource: ['user'] } },
	options: [
		{
			name: 'Add Balance',
			value: 'addBalance',
			action: 'Add to a user balance',
			description:
				'Пополнить баланс — начислить виртуальные рубли или баллы. The money balance can be read but not topped up here: the write side of the API accepts only the other two.',
		},
		{
			name: 'Add Comment',
			value: 'addComment',
			action: 'Add a comment to a user',
			description:
				'Добавить комментарий к пользователю от имени сотрудника. This is one of two endpoints in the API that insist on a numeric user ID — an e-mail will not do.',
		},
		{
			name: 'Add to Groups',
			value: 'addToGroups',
			action: 'Add a user to groups',
			description:
				'Добавить пользователя в группы, не трогая остальные привязки. Answers with the groups the person belongs to afterwards.',
		},
		{
			name: 'Create Diploma',
			value: 'createDiploma',
			action: 'Create a diploma for a user',
			description:
				'Выдать пользователю диплом по шаблону. Nothing in the API lists diploma templates, so the template ID has to come from the account itself.',
		},
		{
			name: 'Get',
			value: 'get',
			action: 'Get a user',
			description:
				'Получить информацию по пользователю. Answers with one user, or with several when the lookup matches more than one — the node emits an item per user either way.',
		},
		{
			name: 'Get Balance',
			value: 'getBalance',
			action: 'Get a user balance',
			description: 'Баланс пользователя — деньги, виртуальный счёт или баллы',
		},
		{
			name: 'Get by Chat ID',
			value: 'getByChatId',
			action: 'Get a user by messenger chat ID',
			description: 'Найти пользователя по переписке в мессенджере — Telegram, ВКонтакте или Max',
		},
		{
			name: 'Get by Telegram Chat ID',
			value: 'getByTelegramChatId',
			action: 'Get a user by telegram chat ID',
			description:
				'Найти пользователя по чату в Telegram — то же, что Get by Chat ID с типом «tg», но без выбора мессенджера',
		},
		{
			name: 'Get Custom Fields',
			value: 'getCustomFields',
			action: 'Get the custom fields of a user',
			description:
				'Дополнительные поля пользователя со значениями. The answer is keyed by field ID and carries the name beside each value, so it lists every field the account defines and not only the filled ones.',
		},
		{
			name: 'Get Deals',
			value: 'getDeals',
			action: 'Get the orders of a user',
			description: 'Заказы пользователя вместе с их позициями',
		},
		{
			name: 'Get Dialogs',
			value: 'getDialogs',
			action: 'Get the dialogs of a user',
			description:
				'Диалоги пользователя из раздела «Входящие». Every dialog carries its own message history, and the endpoint pages 100 at a time.',
		},
		{
			name: 'Get Diplomas',
			value: 'getDiplomas',
			action: 'Get the diplomas of a user',
			description: 'Дипломы, выданные пользователю',
		},
		{
			name: 'Get Goals',
			value: 'getGoals',
			action: 'Get the goal records of a user',
			description:
				'Цели пользователя — the one place in this API where a field arrives with both its name and its numeric ID',
		},
		{
			name: 'Get Groups',
			value: 'getGroups',
			action: 'Get the groups of a user',
			description: 'Группы, в которых состоит пользователь',
		},
		{
			name: 'Get HelpDesk Dialogs',
			value: 'getHelpdeskDialogs',
			action: 'Get the helpdesk tickets of a user',
			description:
				'Тикеты HelpDesk пользователя с историей переписки. The endpoint pages 100 tickets at a time.',
		},
		{
			name: 'Get Lesson Answers',
			value: 'getLessonAnswers',
			action: 'Get the lesson answers of a user',
			description: 'Ответы и комментарии пользователя в уроках, вместе с проверкой преподавателя',
		},
		{
			name: 'Get Purchases',
			value: 'getPurchases',
			action: 'Get the purchases of a user',
			description: 'Покупки пользователя, при желании только по одному продукту',
		},
		{
			name: 'Get Schedule',
			value: 'getSchedule',
			action: 'Get the schedule of a user',
			description: 'Расписание пользователя — что и когда ему открывается',
		},
		{
			name: 'Get Survey Answers',
			value: 'getSurveyAnswers',
			action: 'Get the survey answers of a user',
			description:
				'Ответы пользователя на анкеты. The specification documents no fields at all for this response, so whatever the account stores is passed through unchanged.',
		},
		{
			name: 'Get Trainings',
			value: 'getTrainings',
			action: 'Get the trainings of a user',
			description: 'Тренинги, к которым у пользователя есть доступ',
		},
		{
			name: 'Remove From Groups',
			value: 'removeFromGroups',
			action: 'Remove a user from groups',
			description: 'Удалить пользователя из перечисленных групп, не трогая остальные привязки',
		},
		{
			name: 'Set Groups',
			value: 'setGroups',
			action: 'Replace the groups of a user',
			description:
				'Задать список групп целиком — остальные привязки будут удалены. A user in five groups and a request naming one ends up in that one group only.',
		},
		{
			name: 'Set Personal Manager',
			value: 'setPersonalManager',
			action: 'Set the personal manager of a user',
			description:
				'Назначить или снять персонального менеджера. Leaving the manager empty is how the API is told to remove the current one.',
		},
		{
			name: 'Update',
			value: 'update',
			action: 'Update a user',
			description:
				'Изменить поля пользователя — имя, телефон, город, примечание. The e-mail address is not writable through this API; importing the user through the GetCourse Legacy node is the way to change it.',
		},
		{
			name: 'Update Custom Fields',
			value: 'updateCustomFields',
			action: 'Update the custom fields of a user',
			description:
				'Изменить дополнительные поля пользователя по их числовым ID. The field picker reads the list from the user named above, because this API has no account-wide listing of custom fields.',
		},
	],
};

const messengerType: INodeProperties = {
	displayName: 'Messenger',
	name: 'messengerType',
	type: 'options',
	default: 'tg',
	required: true,
	displayOptions: showFor(['getByChatId']),
	options: [
		{ name: 'Max', value: 'max' },
		{ name: 'Telegram', value: 'tg' },
		{ name: 'VKontakte (ВКонтакте)', value: 'vk' },
	],
	description: 'Тип мессенджера, из которого взят ID чата',
};

const chatId: INodeProperties = {
	displayName: 'Chat ID',
	name: 'chatId',
	type: 'string',
	default: '',
	required: true,
	placeholder: '112345323',
	displayOptions: showFor(['getByChatId', 'getByTelegramChatId']),
	description:
		'ID чата в мессенджере — the number the bot sees, not the handle. A user reached through several bots answers to any of their chat IDs.',
};

const balanceType: INodeProperties = {
	displayName: 'Balance Type',
	name: 'balanceType',
	type: 'options',
	default: 'virtual',
	displayOptions: showFor(['getBalance']),
	options: [
		{ name: 'Money (Обычный счёт)', value: 'normal' },
		{ name: 'Points (Баллы)', value: 'points' },
		{ name: 'Virtual (Виртуальный счёт)', value: 'virtual' },
	],
	description:
		'Тип баланса. GetCourse falls back to the virtual account when nothing is asked for, and the money account is readable here even though Add Balance cannot top it up.',
};

const productId: INodeProperties = {
	displayName: 'Product ID',
	name: 'productId',
	type: 'string',
	default: '',
	displayOptions: showFor(['getPurchases']),
	description:
		"Фильтр по продукту — leave it empty for every purchase. No endpoint lists products, so the ID comes from a purchase already read or from the product's address in the account.",
};

const updateNotice: INodeProperties = {
	displayName:
		'GetCourse отвечает на это пустым массивом: изменённый пользователь не возвращается, поэтому узел отдаёт то, что отправил. Add a Get after this one when the workflow needs the stored values back. Note also that a phone number is both a way of naming the user and a field this operation writes — identify by ID or e-mail whenever the phone number itself is changing.',
	name: 'updateNotice',
	type: 'notice',
	default: '',
	displayOptions: showFor(['update']),
};

const updateFields: INodeProperties = {
	displayName: 'Update Fields',
	name: 'updateFields',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	displayOptions: showFor(['update']),
	options: [
		{
			displayName: 'Birthday',
			name: 'birthday',
			type: 'string',
			default: '',
			placeholder: '1991-01-12',
			description:
				'Дата рождения в виде YYYY-MM-DD. A full timestamp is accepted too and is reduced to its date in the workflow timezone.',
		},
		{
			displayName: 'City',
			name: 'city',
			type: 'string',
			default: '',
			placeholder: 'Москва',
			description: 'Город',
		},
		{
			displayName: 'Comment',
			name: 'comment',
			type: 'string',
			default: '',
			description: 'Примечание — the free-text note on the user card',
		},
		{
			displayName: 'Country',
			name: 'country',
			type: 'string',
			default: '',
			placeholder: 'Россия',
			description: 'Страна',
		},
		{
			displayName: 'First Name',
			name: 'first_name',
			type: 'string',
			default: '',
			description: 'Имя',
		},
		{
			displayName: 'Gender',
			name: 'gender',
			type: 'options',
			default: 'female',
			options: [
				{ name: 'Female (Женский)', value: 'female' },
				{ name: 'Male (Мужской)', value: 'male' },
			],
			description: 'Пол пользователя',
		},
		{
			displayName: 'Last Name',
			name: 'last_name',
			type: 'string',
			default: '',
			description: 'Фамилия',
		},
		{
			displayName: 'Phone',
			name: 'phone',
			type: 'string',
			default: '',
			placeholder: '+79161234567',
			description: 'Номер телефона в международном формате',
		},
	],
};

/**
 * Emptying a field is a separate control, because an empty box cannot mean it.
 *
 * Every writable field on this endpoint is nullable, and `null` is the only way
 * to clear one — an empty string would be stored as an empty string. n8n hands
 * back `''` for every field of a collection the user did not fill in, so a blank
 * box has to mean "leave alone" and clearing has to be said out loud.
 */
const clearFields: INodeProperties = {
	displayName: 'Fields to Clear',
	name: 'clearFields',
	type: 'multiOptions',
	default: [],
	displayOptions: showFor(['update']),
	options: [
		{ name: 'Birthday', value: 'birthday' },
		{ name: 'City', value: 'city' },
		{ name: 'Comment', value: 'comment' },
		{ name: 'Country', value: 'country' },
		{ name: 'First Name', value: 'first_name' },
		{ name: 'Gender', value: 'gender' },
		{ name: 'Last Name', value: 'last_name' },
		{ name: 'Phone', value: 'phone' },
	],
	description:
		'Поля, которые нужно очистить — каждое отправляется как null. A field named here is cleared even when Update Fields also carries a value for it.',
};

const setGroupsNotice: INodeProperties = {
	displayName:
		'Эта операция задаёт членство целиком: группы, которых нет в списке, будут сняты, а пустой список снимет все. GetCourse states it plainly — «остальные привязки будут удалены». To add or remove without touching the rest, use Add to Groups or Remove From Groups instead.',
	name: 'setGroupsNotice',
	type: 'notice',
	default: '',
	displayOptions: showFor(['setGroups']),
};

const groups: INodeProperties = {
	displayName: 'Group Names or IDs',
	name: 'groups',
	type: 'multiOptions',
	typeOptions: { loadOptionsMethod: 'getGroups' },
	default: [],
	displayOptions: showFor(GROUP_WRITES),
	description:
		'Группы аккаунта, по их ID. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const amount: INodeProperties = {
	displayName: 'Amount',
	name: 'amount',
	type: 'number',
	default: 0,
	required: true,
	displayOptions: showFor(['addBalance']),
	description:
		'Количество — сколько начислить. The API declares this an integer, so a fractional amount does not survive the trip.',
};

const addBalanceType: INodeProperties = {
	displayName: 'Balance Type',
	name: 'addBalanceType',
	type: 'options',
	default: 'virtual',
	displayOptions: showFor(['addBalance']),
	options: [
		{ name: 'Points (Баллы)', value: 'points' },
		{ name: 'Virtual (Виртуальный счёт)', value: 'virtual' },
	],
	description:
		'Тип баланса. Get Balance additionally reads the money account, but this endpoint cannot write to it — the schema enumerates only these two.',
};

const balanceComment: INodeProperties = {
	displayName: 'Comment',
	name: 'balanceComment',
	type: 'string',
	default: '',
	displayOptions: showFor(['addBalance']),
	description:
		'Комментарий к начислению, видимый в истории баланса. The schema marks it required while its own text says the account supplies one when it is blank, so the node sends the key either way.',
};

const managerId: INodeProperties = {
	displayName: 'Manager Name or ID',
	name: 'managerId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getManagers' },
	default: '',
	displayOptions: showFor(['setPersonalManager']),
	description:
		'Персональный менеджер; оставьте пустым, чтобы снять текущего. The list holds the account\'s personal managers, the only staff listing the API publishes. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const templateId: INodeProperties = {
	displayName: 'Diploma Template ID',
	name: 'templateId',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['createDiploma']),
	description:
		"ID шаблона диплома. Nothing in this API lists templates — the number is the one in the template's address under Дипломы in the account.",
};

const diplomaFields: INodeProperties = {
	displayName: 'Additional Fields',
	name: 'diplomaFields',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	displayOptions: showFor(['createDiploma']),
	options: [
		{
			displayName: 'Allow Duplicates',
			name: 'allowDuplicates',
			type: 'boolean',
			default: false,
			description:
				'Whether to issue the diploma even when the user already holds one from this template (разрешать дубликаты)',
		},
		{
			displayName: 'Diploma Number',
			name: 'number',
			type: 'string',
			default: '',
			description: 'Номер диплома; если не задан, GetCourse возьмёт следующий по порядку',
		},
		{
			displayName: 'Send Notification',
			name: 'sendNotify',
			type: 'boolean',
			default: true,
			description:
				'Whether to tell the user that the diploma has been issued (отправлять уведомление)',
		},
		{
			displayName: 'Training Name',
			name: 'trainingName',
			type: 'string',
			default: '',
			description: 'Название тренинга на дипломе; если не задано, берётся из самого тренинга',
		},
		{
			displayName: 'User Name',
			name: 'userName',
			type: 'string',
			default: '',
			description: 'Имя на дипломе; если не задано, берётся из карточки пользователя',
		},
	],
};

const commentUserId: INodeProperties = {
	displayName: 'User ID',
	name: 'commentUserId',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['addComment']),
	description:
		'ID пользователя, к которому добавляется комментарий. This endpoint takes no e-mail and no phone number, unlike the rest of the resource.',
};

const authorId: INodeProperties = {
	displayName: 'Author Name or ID',
	name: 'authorId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getManagers' },
	default: '',
	required: true,
	displayOptions: showFor(['addComment']),
	description:
		'Сотрудник, от имени которого пишется комментарий. The list holds the account\'s personal managers, the only staff listing the API publishes; another employee ID typed in by hand may well be accepted. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const commentText: INodeProperties = {
	displayName: 'Comment Text',
	name: 'text',
	type: 'string',
	typeOptions: { rows: 4 },
	default: '',
	required: true,
	displayOptions: showFor(['addComment']),
	description: 'Текст комментария',
};

export const description: INodeProperties[] = [
	operation,
	...userIdentifierProperties('user', IDENTIFIED),
	messengerType,
	chatId,
	balanceType,
	productId,
	...returnAllProperties(showFor(PAGED)),
	updateNotice,
	updateFields,
	clearFields,
	customFieldsProperty('user', ['updateCustomFields']),
	setGroupsNotice,
	groups,
	amount,
	addBalanceType,
	balanceComment,
	managerId,
	templateId,
	diplomaFields,
	commentUserId,
	authorId,
	commentText,
];
