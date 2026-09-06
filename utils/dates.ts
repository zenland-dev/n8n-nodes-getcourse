/**
 * GetCourse speaks wall-clock strings, not timestamps.
 *
 * Export filters take `YYYY-MM-DD`, deal dates take `YYYY-MM-DD HH:MM:SS`, and
 * both are read in the account's own timezone. n8n hands date inputs over as ISO
 * instants, so a conversion is unavoidable — and it has to happen in a named
 * timezone, otherwise `2026-03-01T00:30:00+03:00` becomes the 28th of February
 * for a Moscow school.
 *
 * The timezone used is the workflow's, which is what the person building the
 * workflow sees in the n8n interface. When the account sits in another zone the
 * two can disagree by a few hours; that is worth a line in the README, not a
 * silent guess at the account's settings.
 *
 * Unparseable input is passed through unchanged rather than dropped. Silently
 * omitting a mistyped date is the worst of the options: the request succeeds,
 * the filter is missing, and nobody finds out. Passing the text through makes
 * GetCourse answer with an error that names the problem.
 */

/** Already in GetCourse's own shape — leave it alone. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;

/**
 * `01.03.2026` — the way a date is written in Russian, and the way GetCourse's
 * own interface shows one.
 *
 * It has to be recognised here because the fallback below cannot be trusted with
 * it: V8's legacy parser reads `01.03.2026` as the third of January, silently,
 * and only for the first twelve days of a month — from the thirteenth it fails
 * and the text passes through instead. A filter that quietly returns January
 * data for a March request is the worst kind of wrong, so the dotted form is
 * parsed here, day first, which is the only reading anyone writing dots means.
 *
 * Slashes and dashes are deliberately NOT included: `03/01/2026` is genuinely
 * ambiguous, and guessing there would move the same bug rather than fix it.
 */
const RU_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

const pad = (value: string | number, width = 2): string => String(value).padStart(width, '0');

function parts(instant: Date, timezone: string): Record<string, string> {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	});

	const result: Record<string, string> = {};
	for (const part of formatter.formatToParts(instant)) result[part.type] = part.value;

	// Some ICU builds render midnight as hour 24 rather than 00.
	if (result.hour === '24') result.hour = '00';

	return result;
}

function fromInstant(instant: Date, timezone: string, withTime: boolean): string {
	const at = parts(instant, timezone);
	const date = `${at.year}-${at.month}-${at.day}`;

	return withTime ? `${date} ${at.hour}:${at.minute}:${at.second}` : date;
}

function format(value: unknown, timezone: string, withTime: boolean): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;

	// An expression can hand back a real Date; stringifying it first would send it
	// through the fallback parser for no reason.
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? undefined : fromInstant(value, timezone, withTime);
	}

	const text = String(value).trim();
	if (text === '') return undefined;

	if (DATE_ONLY.test(text)) return withTime ? `${text} 00:00:00` : text;

	if (DATE_TIME.test(text)) {
		const [date, time] = text.replace('T', ' ').split(' ');
		return withTime ? `${date} ${time.length === 5 ? `${time}:00` : time}` : date;
	}

	const russian = RU_DATE.exec(text);
	if (russian !== null) {
		const [, day, month, year, hour, minute, second] = russian;
		const date = `${year}-${pad(month)}-${pad(day)}`;

		return withTime
			? `${date} ${pad(hour ?? '0')}:${pad(minute ?? '0')}:${pad(second ?? '0')}`
			: date;
	}

	const parsed = Date.parse(text);
	if (Number.isNaN(parsed)) return text;

	return fromInstant(new Date(parsed), timezone, withTime);
}

/**
 * Whether a value came out of the two formatters in the shape GetCourse takes.
 *
 * The formatters pass unrecognised text through on purpose, so that a mistyped
 * date reaches the API and is named in its answer rather than being dropped.
 * That is the right default for a write, where GetCourse validates. It is the
 * wrong one for an export filter: an ignored `created_at` turns a narrow request
 * into a whole-account dump against a budget of a hundred requests, so the
 * export checks its dates with this before sending them.
 */
export function isGetCourseDate(value: unknown): boolean {
	return typeof value === 'string' && DATE_ONLY.test(value);
}

/** `YYYY-MM-DD`, as the export filters want it. */
export function toGetCourseDate(value: unknown, timezone: string): string | undefined {
	return format(value, timezone, false);
}

/** `YYYY-MM-DD HH:MM:SS`, as deal creation and payment dates want it. */
export function toGetCourseDateTime(value: unknown, timezone: string): string | undefined {
	return format(value, timezone, true);
}
