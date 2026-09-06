import type { INodeProperties } from 'n8n-workflow';

/**
 * The hosts GetCourse serves accounts on out of the box.
 *
 * Unlike amoCRM, this list cannot be the whole story: GetCourse lets an account
 * bind its own domain, and when the account has a forced redirect from
 * `<account>.getcourse.ru` to that domain, the API only answers on the custom
 * one — the platform's own help page says so. So the credential offers a second
 * mode instead of pretending the list is closed.
 *
 * The list still matters: in the default mode a credential cannot be aimed
 * anywhere but GetCourse, and that is the mode almost every account uses.
 */
export const ACCOUNT_DOMAINS = ['getcourse.ru', 'getcourse.io'] as const;

/** Everything a host label may contain. Anything else is dropped, not rejected. */
const SUBDOMAIN_ALLOWED = /[^a-z0-9-]/g;

/** Everything a full hostname may contain, once the scheme and path are gone. */
const HOSTNAME_ALLOWED = /[^a-z0-9.-]/g;

/** An address written as numbers — every dotted-decimal IPv4, shorthand included. */
const NUMERIC_HOST = /^[0-9.]+$/;

/**
 * Reduces whatever the user typed into a bare hostname.
 *
 * People paste `https://school.example.com/pl/api/` as readily as they type
 * `school.example.com`, and both have to end up as the same host.
 *
 * Two values are refused, and it is worth being exact about why, because the
 * obvious reading — that this keeps requests off the n8n machine's network — is
 * **not** what it does. A single label with no dot left in it (`localhost`, a
 * bare machine name) cannot be a GetCourse school, so it is a typo. A host made
 * only of digits and dots is an IP address spelled out, which a school also
 * never is; refusing it costs nothing and takes the easiest way of aiming a
 * credential at `127.0.0.1` or `169.254.169.254` off the table, shorthand forms
 * like `127.1` included.
 *
 * What remains permitted is any real hostname, `db.internal` and
 * `metadata.google.internal` among them. That is a shape check, not a network
 * boundary: the host is trusted because whoever can write the credential is
 * already trusted with the key inside it, and n8n has no notion of an allowed
 * egress range to check against. A suffix blocklist is deliberately not
 * attempted — it would have to be reproduced character for character inside the
 * expression below, and the day the two drift is the day a credential tests
 * green against one host while the node talks to another.
 */
function normaliseHostname(value: unknown): string {
	const host = String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
		.split('/')[0]
		.split('?')[0]
		.split('@')
		.pop()!
		.split(':')[0]
		.replace(HOSTNAME_ALLOWED, '')
		.replace(/^\.+|\.+$/g, '');

	if (!host.includes('.')) return '';

	// Mirrored exactly in `accountHostExpression`; change the two together.
	return NUMERIC_HOST.test(host) ? '' : host;
}

/**
 * Builds the account host from the credential fields, as an n8n expression.
 *
 * The same rule runs again in `accountBaseUrl` below, because a credential's
 * `options` are only a hint to the editor: stored values reach the node through
 * the expression engine and can be set by anything able to write the credential.
 *
 * `ref` differs by context — property defaults read sibling fields through
 * `$self`, credential tests through `$credentials`.
 */
export function accountHostExpression(ref: string): string {
	const domains = JSON.stringify([...ACCOUNT_DOMAINS]);
	const subdomain = `String(${ref}.subdomain || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "")`;
	const domain = `String(${ref}.domain || "")`;

	// Step for step the same reduction as `normaliseHostname` below, and it has to
	// stay that way: this expression decides where the credential test goes, the
	// function decides where the node goes, and a credential that tests green
	// against one host while the node talks to another is worse than one that
	// simply fails. The pieces that matter are dropping any userinfo before the @
	// and any port after the colon — without them a value like
	// `user@evil.com` or `school.example.com:8443` produces two different hosts.
	const custom =
		`String(${ref}.customDomain || "")` +
		'.trim().toLowerCase()' +
		'.replace(/^[a-z][a-z0-9+.-]*:\\/\\//, "")' +
		'.split("/")[0].split("?")[0].split("@").pop().split(":")[0]' +
		'.replace(/[^a-z0-9.-]/g, "")' +
		'.replace(/^\\.+|\\.+$/g, "")';

	return (
		`String(${ref}.accountMode) === "customDomain"` +
		// The numeric-host test mirrors NUMERIC_HOST in `normaliseHostname`. Both
		// halves have to refuse the same values or the credential test and the node
		// end up pointed at different hosts.
		` ? (${custom}.includes(".") && !/^[0-9.]+$/.test(${custom}) ? ${custom} : "")` +
		` : (${domains}.includes(${domain}) && ${subdomain} !== "" ? ${subdomain} + "." + ${domain} : "")`
	);
}

/** The same rule in plain TypeScript, for the transport. */
export function accountBaseUrl(credentials: {
	accountMode?: unknown;
	subdomain?: unknown;
	domain?: unknown;
	customDomain?: unknown;
}): string {
	if (String(credentials.accountMode ?? '') === 'customDomain') {
		const host = normaliseHostname(credentials.customDomain);
		return host === '' ? '' : `https://${host}`;
	}

	const domain = String(credentials.domain ?? '');
	if (!(ACCOUNT_DOMAINS as readonly string[]).includes(domain)) return '';

	const subdomain = String(credentials.subdomain ?? '')
		.trim()
		.toLowerCase()
		.replace(SUBDOMAIN_ALLOWED, '');

	return subdomain === '' ? '' : `https://${subdomain}.${domain}`;
}

/** Address fields, shared by both credential types so they cannot drift apart. */
export const accountAddressProperties: INodeProperties[] = [
	{
		displayName: 'Account Address',
		name: 'accountMode',
		type: 'options',
		default: 'subdomain',
		required: true,
		options: [
			{
				name: 'GetCourse Subdomain',
				value: 'subdomain',
				description: 'Адрес вида myschool.getcourse.ru. The usual case.',
			},
			{
				name: 'Custom Domain',
				value: 'customDomain',
				description:
					'Собственный домен школы. Needed when the account force-redirects its GetCourse address to a domain of its own — the API then answers only on that domain.',
			},
		],
		description:
			'How to reach the account. Pick Custom Domain only if the plain address redirects.',
	},
	{
		displayName: 'Subdomain',
		name: 'subdomain',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'myschool',
		displayOptions: { show: { accountMode: ['subdomain'] } },
		description:
			'Имя аккаунта. The part of the address in front of the domain — for myschool.getcourse.ru that is myschool. Only letters, digits and hyphens are kept.',
	},
	{
		displayName: 'Domain',
		name: 'domain',
		type: 'options',
		default: 'getcourse.ru',
		required: true,
		options: [
			{ name: 'Getcourse.io', value: 'getcourse.io', description: 'Accounts outside Russia' },
			{ name: 'Getcourse.ru', value: 'getcourse.ru', description: 'Russian accounts' },
		],
		displayOptions: { show: { accountMode: ['subdomain'] } },
		description:
			'Which GetCourse installation hosts the account. The list is closed on purpose: in this mode a credential cannot be aimed at another server.',
	},
	{
		displayName: 'Custom Domain',
		name: 'customDomain',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'school.example.com',
		displayOptions: { show: { accountMode: ['customDomain'] } },
		description:
			'Домен школы, без схемы и пути. This credential will send the account API key to that host, so make sure it is the school domain and nothing else.',
	},
];

/**
 * Pins n8n's own domain-restriction field to "none" and hides it.
 *
 * n8n injects this field into every credential carrying an `authenticate` block,
 * defaulting to "all" — and with "all" anyone who can edit the credential may
 * select it in an HTTP Request node, type any URL, and have n8n attach the token
 * to it. Declaring the property ourselves skips that injection entirely.
 */
export const pinnedHttpRequestDomains: INodeProperties = {
	displayName: 'Allowed HTTP Request Domains',
	name: 'allowedHttpRequestDomains',
	type: 'hidden',
	default: 'none',
};
