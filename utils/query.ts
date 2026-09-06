import type { IDataObject } from 'n8n-workflow';

/**
 * GetCourse reads its export filters from PHP-style bracket keys —
 * `created_at[from]`, `added_at[to]` — so nested query objects have to be
 * flattened before they reach the HTTP layer.
 *
 * Empty values are dropped: n8n collections hand back `''` for every field the
 * user left alone, and an empty filter is not the same request as no filter.
 */
export function flattenQuery(input?: IDataObject): IDataObject {
	const output: IDataObject = {};

	const walk = (value: unknown, path: string): void => {
		if (value === undefined || value === null || value === '') return;

		if (Array.isArray(value)) {
			value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
			return;
		}

		if (typeof value === 'object') {
			for (const [key, entry] of Object.entries(value as IDataObject)) {
				walk(entry, `${path}[${key}]`);
			}
			return;
		}

		output[path] = value as string | number | boolean;
	};

	for (const [key, value] of Object.entries(input ?? {})) walk(value, key);

	return output;
}

/** Drops keys whose value is undefined, null or an empty string. */
export function omitEmpty(input: IDataObject): IDataObject {
	const output: IDataObject = {};

	for (const [key, value] of Object.entries(input)) {
		if (value === undefined || value === null || value === '') continue;
		output[key] = value;
	}

	return output;
}

/** Splits a comma-separated list the way every "IDs" field in this node does. */
export function splitList(value: unknown): string[] {
	return String(value ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry !== '');
}
