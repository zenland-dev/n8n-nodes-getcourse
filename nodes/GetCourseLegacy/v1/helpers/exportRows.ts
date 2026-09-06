import type { IDataObject } from 'n8n-workflow';

/**
 * An export answers with a table, not a list of objects: `info.fields` holds the
 * column titles and `info.items` holds an array of arrays aligned to them.
 *
 * The column set is account-specific — every custom user or order field is
 * spliced into the middle of the row — so nothing may be read by index. Zipping
 * the two arrays is the only safe way to make sense of a row.
 */
export interface ExportTable {
	fields: string[];
	items: unknown[][];
}

/** Reads the table out of an export envelope, tolerating a response without one. */
export function readTable(info: unknown): ExportTable | undefined {
	if (info === null || typeof info !== 'object') return undefined;

	const source = info as IDataObject;
	const fields = source.fields;
	const items = source.items;

	if (!Array.isArray(fields) || !Array.isArray(items)) return undefined;

	return {
		fields: fields.map((field) => String(field ?? '')),
		items: items.map((row) => (Array.isArray(row) ? row : [row])),
	};
}

const CYRILLIC: Record<string, string> = {
	а: 'a',
	б: 'b',
	в: 'v',
	г: 'g',
	д: 'd',
	е: 'e',
	ё: 'e',
	ж: 'zh',
	з: 'z',
	и: 'i',
	й: 'y',
	к: 'k',
	л: 'l',
	м: 'm',
	н: 'n',
	о: 'o',
	п: 'p',
	р: 'r',
	с: 's',
	т: 't',
	у: 'u',
	ф: 'f',
	х: 'h',
	ц: 'ts',
	ч: 'ch',
	ш: 'sh',
	щ: 'sch',
	ъ: '',
	ы: 'y',
	ь: '',
	э: 'e',
	ю: 'yu',
	я: 'ya',
	і: 'i',
	ї: 'yi',
	є: 'ye',
	ґ: 'g',
	ў: 'u',
};

/**
 * Turns «Стоимость, RUB» into `stoimost_rub`.
 *
 * GetCourse names its columns the way a person would write them — Russian, with
 * spaces, commas, quotes and parentheses. Those are legal JSON keys but painful
 * in an expression, so this is offered as an alternative. It is deliberately
 * lossy and deliberately optional: the exact titles remain the default, because
 * they are what the account's own CSV export shows.
 */
export function slugifyColumn(title: string): string {
	const latin = [...title.toLowerCase()]
		.map((char) => (char in CYRILLIC ? CYRILLIC[char] : char))
		.join('');

	const slug = latin
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.replace(/_{2,}/g, '_');

	return slug === '' ? 'column' : slug;
}

/**
 * Builds the key for every column, keeping them distinct.
 *
 * Two custom fields can share a title, and transliteration can collide where the
 * originals did not. A silently dropped column is the worst outcome, so a repeat
 * gets a numeric suffix.
 */
function columnKeys(fields: string[], style: string): string[] {
	const seen = new Map<string, number>();

	const bases = fields.map(
		(field, index) =>
			(style === 'slug' ? slugifyColumn(field) : field.trim()) || `column_${index + 1}`,
	);

	// Every base name is reserved before any suffix is handed out, so a generated
	// `x_2` cannot take the name of a column genuinely called `x_2`. Without that,
	// columns named x, x, x_2 collapse into two and one of them is lost silently.
	const taken = new Set(bases);

	return bases.map((base) => {
		const previous = seen.get(base) ?? 0;
		seen.set(base, previous + 1);

		if (previous === 0) return base;

		let attempt = previous;
		let candidate = `${base}_${attempt + 1}`;

		while (taken.has(candidate)) {
			attempt += 1;
			candidate = `${base}_${attempt + 1}`;
		}

		taken.add(candidate);

		return candidate;
	});
}

/**
 * Zips the table into one object per row.
 *
 * A row shorter than the header is padded with nulls rather than truncated: a
 * trailing empty cell is normal in this API, and a row that silently loses its
 * last columns is far harder to notice than a null.
 */
export function tableToRows(table: ExportTable, keyStyle = 'original'): IDataObject[] {
	const keys = columnKeys(table.fields, keyStyle);

	return table.items.map((row) => {
		const entry: IDataObject = {};

		keys.forEach((key, index) => {
			const value = row[index];
			entry[key] = value === undefined ? null : (value as IDataObject[string]);
		});

		return entry;
	});
}
