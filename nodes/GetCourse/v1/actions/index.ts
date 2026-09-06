import type { INodeProperties } from 'n8n-workflow';

import type { ResourceModule } from '../../../../utils/router';
import * as call from './call';
import * as deal from './deal';
import * as dialog from './dialog';
import * as helpdesk from './helpdesk';
import * as lesson from './lesson';
import * as offer from './offer';
import * as school from './school';
import * as user from './user';
import * as webhook from './webhook';
import * as webinar from './webinar';

/** Keyed by the `resource` value, which is part of every saved workflow. */
export const resources: Record<string, ResourceModule> = {
	call,
	deal,
	dialog,
	helpdesk,
	lesson,
	offer,
	school,
	user,
	webhook,
	webinar,
};

/**
 * Kept alphabetical: the linter enforces it, and so does finding things.
 *
 * There is no Create and no Delete anywhere in this node, for any resource, and
 * that is the API's doing rather than an omission here — the Tech API reads and
 * updates existing objects and nothing else. Users, orders and payments are
 * created through the legacy Import API, which is what the GetCourse Legacy node
 * is for.
 */
export const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	default: 'user',
	options: [
		{
			name: 'Call',
			value: 'call',
			description: 'Звонок: комментарий и транскрибация. Both overwrite what is already there.',
		},
		{
			name: 'Dialog',
			value: 'dialog',
			description:
				'Диалог во «Входящие»: ответить, перевести в отдел, закрыть, прочитать переписку',
		},
		{
			name: 'HelpDesk Ticket',
			value: 'helpdesk',
			description:
				'Тикет HelpDesk — отдельная от «Входящих» система с собственным пространством ID',
		},
		{
			name: 'Lesson',
			value: 'lesson',
			description: 'Ответы на урок: прочитать, прокомментировать, сменить статус',
		},
		{
			name: 'Offer',
			value: 'offer',
			description: 'Предложение: карточка, список и теги',
		},
		{
			name: 'Order',
			value: 'deal',
			description: 'Заказ: поля, позиции, комментарии, звонки и дополнительные поля',
		},
		{
			name: 'School',
			value: 'school',
			description: 'Справочники аккаунта: группы, отделы, тренинги, менеджеры, ответы на анкеты',
		},
		{
			name: 'User',
			value: 'user',
			description: 'Пользователь: профиль, группы, покупки, баланс, дипломы, диалоги',
		},
		{
			name: 'Webhook',
			value: 'webhook',
			description:
				'Подписка на события через set-uri. The GetCourse Trigger node does this for itself; this resource is for a URL outside n8n.',
		},
		{
			name: 'Webinar',
			value: 'webinar',
			description: 'Вебинар: список, комментарии в чате и модерация',
		},
	],
};

export const resourceProperties: INodeProperties[] = Object.values(resources).flatMap(
	(module) => module.description,
);
