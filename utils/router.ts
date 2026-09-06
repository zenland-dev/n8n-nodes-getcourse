import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/* eslint-disable @n8n/community-nodes/require-node-api-error --
   Everything re-thrown below has already passed through a transport, which turns
   GetCourse failures into a NodeApiError carrying a message the user can act on.
   Wrapping it again here would bury that message under a generic one. */

/** Everything a node needs to know about one resource. */
export interface ResourceModule {
	/** Operation selector and every parameter belonging to this resource. */
	description: INodeProperties[];
	/** Handles one input item. */
	execute(
		this: IExecuteFunctions,
		operation: string,
		itemIndex: number,
	): Promise<INodeExecutionData[]>;
}

function errorItem(error: unknown, itemIndex: number): INodeExecutionData {
	return {
		json: { error: error instanceof Error ? error.message : String(error) },
		pairedItem: { item: itemIndex },
	};
}

/**
 * Runs the selected resource and operation once per input item.
 *
 * Both GetCourse nodes share this: neither API takes several entities in one
 * call, so there is no batching to model — one item in, one request out, and
 * `pairedItem` stays honest without any bookkeeping.
 */
export async function routeItems(
	this: IExecuteFunctions,
	resources: Record<string, ResourceModule>,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const resource = this.getNodeParameter('resource', 0) as string;
	const operation = this.getNodeParameter('operation', 0) as string;

	const module = resources[resource];
	if (module === undefined) {
		throw new NodeOperationError(this.getNode(), `Unknown resource "${resource}"`);
	}

	const output: INodeExecutionData[] = [];

	for (let index = 0; index < items.length; index++) {
		try {
			const results = await module.execute.call(this, operation, index);

			for (const result of results) {
				output.push({ ...result, pairedItem: result.pairedItem ?? { item: index } });
			}
		} catch (error) {
			if (!this.continueOnFail()) throw error;
			output.push(errorItem(error, index));
		}
	}

	return [output];
}

/** The error every resource throws for an operation it does not implement. */
export function unknownOperation(
	this: IExecuteFunctions,
	resourceLabel: string,
	operation: string,
	itemIndex: number,
): NodeOperationError {
	return new NodeOperationError(
		this.getNode(),
		`The ${resourceLabel} resource has no operation "${operation}"`,
		{ itemIndex },
	);
}
