import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { routeItems } from '../../utils/router';
import { resourceProperties, resourceProperty, resources } from './v1/actions';
import { loadOptions } from './v1/methods';

export class GetCourseLegacy implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'GetCourse Legacy',
		name: 'getCourseLegacy',
		icon: {
			light: 'file:../../icons/getcourse.svg',
			dark: 'file:../../icons/getcourse.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description:
			'Import users and orders into GetCourse, and export users, orders, payments and group members out of it, through the account Import/Export API',
		defaults: { name: 'GetCourse Legacy' },
		usableAsTool: true,
		// Read by n8n's node catalog (@n8n/ai-utilities): searchHint is printed
		// verbatim to a model choosing a node, and it is the only place to say
		// things no single operation description can. Wire-format expressions are
		// rejected here by the community-nodes linter.
		builderHint: {
			searchHint:
				'GetCourse has two separate APIs and this node is the older one — the account Import/Export API, keyed by the School API Key on the shared GetCourse API credential — the same value GetCourse shows as the secret key under Профиль → Настройки аккаунта → АПИ. It is the only way to CREATE a user or an order, and the only way to read them in bulk; the GetCourse node covers the newer Tech API, which can read and update single objects but create nothing. Bulk reads are asynchronous: Export and Wait does the whole job in one node, while Start, Check Status and Get Result split it across a chain with an n8n Wait node in between. The account gets 100 export requests per two hours in total and every status check counts, so this is a nightly-report tool, not a polling trigger — for reacting to events, point a GetCourse process with the «Вызвать URL» operation at a GetCourse Trigger node.',
			relatedNodes: [
				{
					nodeType: 'n8n-nodes-getcourse.getCourse',
					relationHint:
						'The newer Tech API: reads and updates one user, order, offer, dialog or webinar at a time',
				},
				{
					nodeType: 'n8n-nodes-getcourse.getCourseTrigger',
					relationHint: 'Starts the workflow when GetCourse reports an event',
				},
			],
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'getCourseTechApi', required: true }],
		properties: [resourceProperty, ...resourceProperties],
	};

	methods = { loadOptions };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await routeItems.call(this, resources);
	}
}
