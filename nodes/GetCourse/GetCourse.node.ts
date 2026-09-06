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

export class GetCourse implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'GetCourse',
		name: 'getCourse',
		icon: {
			light: 'file:../../icons/getcourse.svg',
			dark: 'file:../../icons/getcourse.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description:
			'Read and update users, orders, offers, dialogs, lessons and webinars in a GetCourse account through the Tech API',
		defaults: { name: 'GetCourse' },
		usableAsTool: true,
		// Read by n8n's node catalog (@n8n/ai-utilities): searchHint is printed verbatim
		// to a model choosing a node, and it is the only place to say what no single
		// operation description can. Wire-format expressions are rejected here by the
		// community-nodes linter.
		builderHint: {
			searchHint:
				"GetCourse has two unrelated APIs and this node is the newer one, the Tech API. It can READ and UPDATE a user, an order, an offer, a dialog, a HelpDesk ticket, a lesson answer or a webinar, one at a time — it cannot CREATE anything and cannot list users or orders in bulk, because the API has no method for either. Creating a user or an order, and any bulk read, is the GetCourse Legacy node. Most user operations take one of three identifiers — the numeric ID if you have it, otherwise the e-mail, otherwise the phone — and the node asks which one you mean rather than letting you send two. Custom fields are read by name and written by numeric ID, and no method in this API lists those IDs: the Legacy node's Custom Field resource is where they come from. Authentication needs two keys glued with an underscore, a developer key GetCourse issues to integrators and a school key the school itself hands out.",
			relatedNodes: [
				{
					nodeType: 'n8n-nodes-getcourse.getCourseLegacy',
					relationHint:
						'Creates users and orders, exports them in bulk, and lists the custom-field dictionary this node cannot',
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
