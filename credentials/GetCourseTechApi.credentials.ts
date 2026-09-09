import type { Icon, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

import { accountAddressProperties, accountHostExpression } from './accountAddress';

/** The account host, assembled from the address fields. */
export const ACCOUNT_BASE_URL = `=https://{{ ${accountHostExpression('$credentials')} }}`;

/**
 * The Tech API bearer token: two keys glued with an underscore.
 *
 * GetCourse issues the two halves to different people — the developer key to the
 * integrator who filled in the form at getcourse.ru/issuedeveloperkey, the school
 * key by the school itself — so they are separate fields. Splicing them into one
 * string is the documented format, not a convenience.
 */
const TECH_BEARER = '=Bearer {{$credentials.developerApiKey}}_{{$credentials.schoolApiKey}}';

/**
 * Which endpoint the Test button asks, and why it depends on what is filled in.
 *
 * One credential, two APIs, and only one of them needs the developer key — so a
 * fixed endpoint would report red at somebody whose setup is fine. The choice is
 * made from the developer key because that is the field only the Tech API needs:
 * with it, the Tech dictionary proves the bearer; without it, the legacy group
 * list proves the school key. Both are GETs that take no filter, so nothing but
 * the URL varies.
 *
 * `/pl/api/account/groups` is the legacy half rather than `/pl/api/account/fields`
 * because it answers a GET. Both live under `/pl/api/account/`, so both are
 * counted against the export budget by the node either way.
 */
const TEST_URL =
	'={{ $credentials.developerApiKey ? "/pl/api/v1/common/get-departments" : "/pl/api/account/groups" }}';

/**
 * What the Test button reports, and why there are two kinds of rule.
 *
 * n8n reads the two kinds on different paths, and neither covers the other.
 * `responseSuccessBody` is consulted **only** when the request came back 2xx;
 * `responseCode` **only** on the failure path. So a rule of the wrong kind is
 * not a weaker message, it is no message: without the `responseCode` entries a
 * redirecting account reported the single word `Found` and a rejected key pair
 * reported `Forbidden`, while the sentence written for them sat in a rule n8n
 * never reached.
 *
 * The two body rules do not collide. The legacy half answers `{success, info}`
 * and the Tech half `{status, message, code, errors, data}`, so on either branch
 * the other API's key is simply absent — and the check is a strict
 * `get(body, key) === value`, which `undefined` does not satisfy against `false`.
 * That is also why there is no rule for a 2xx that is not this API at all: it
 * would have to match on the key being absent, and on each branch one of the two
 * legitimately is.
 *
 * Mixing the kinds is fine at runtime — each loop filters on `rule.type` — but
 * `rules` is typed as a union of two arrays, hence the cast.
 */
const TEST_RULES: ICredentialTestRequest['rules'] = [
	{
		type: 'responseCode',
		properties: {
			value: 301,
			message:
				'Аккаунт перенаправляет свой getcourse.ru-адрес на собственный домен, а API отвечает только на нём. Switch this credential to Custom Domain and enter that domain. The redirect was not followed on purpose: it would have sent the key to the other host.',
		},
	},
	{
		type: 'responseCode',
		properties: {
			value: 302,
			message:
				'Аккаунт перенаправляет свой getcourse.ru-адрес на собственный домен, а API отвечает только на нём. Switch this credential to Custom Domain and enter that domain. The redirect was not followed on purpose: it would have sent the key to the other host.',
		},
	},
	{
		type: 'responseCode',
		properties: {
			value: 401,
			message:
				'GetCourse не принял ключи. Check the school key and, for the GetCourse node, the developer key from getcourse.ru/issuedeveloperkey.',
		},
	},
	{
		type: 'responseCode',
		properties: {
			value: 403,
			message:
				'GetCourse отказал в доступе (403). Either the developer key or the school key is wrong, the two belong to different schools, or the school has not enabled this developer key.',
		},
	},
	{
		type: 'responseCode',
		properties: {
			value: 404,
			message:
				'По этому адресу нет аккаунта GetCourse. Check the account name — for myschool.getcourse.ru it is myschool — and the domain next to it.',
		},
	},
	{
		type: 'responseSuccessBody',
		properties: {
			key: 'success',
			value: false,
			message:
				'GetCourse refused the school key. Check the key and the account address, and that the account is on a paid plan — the Import/Export API the GetCourse Legacy node uses is switched off on the trial one. If the account redirects its GetCourse address to a domain of its own, switch this credential to Custom Domain: the API answers only on that domain.',
		},
	},
	{
		type: 'responseSuccessBody',
		properties: {
			key: 'status',
			value: false,
			message:
				'GetCourse ответил отказом на Tech API. The address is reachable, so check the developer key and the school key, and that both belong to this account.',
		},
	},
] as ICredentialTestRequest['rules'];

/**
 * One credential for every node in this package.
 *
 * It is named for the Tech API because that is the API GetCourse is building on,
 * but it serves the legacy Import/Export API too, and that is not a compromise:
 * the school key below is the account key both of them take. GetCourse documents
 * them as two things — «ключ АПИ школы» for the Tech API, the secret key under
 * Профиль → Настройки аккаунта → АПИ for the older one — and on every account
 * tried they are one value. So there is one field for it, not two.
 *
 * The GetCourse Legacy node exists only because the Tech API cannot create a
 * user or read anything in bulk. It is a second node, not a second account and
 * not a second key.
 *
 * There is deliberately no `authenticate` block, and it is not an oversight.
 * Declaring one makes n8n offer the credential inside an HTTP Request node —
 * where whoever can edit it may point it at any URL and have n8n attach the
 * key — and inject its Allowed HTTP Request Domains field to fence that off.
 * Pinning that field to `none` is what this credential used to do, and on some
 * n8n versions it refuses the credential's own Test button with «This credential
 * is configured to prevent use within an HTTP Request node». Omitting
 * `authenticate` removes the exposure at the source: n8n never offers the
 * credential there, never injects the field, and has nothing to refuse. Each
 * transport attaches its own auth, which the legacy half always did anyway —
 * its key is a form field, not a header.
 */
export class GetCourseTechApi implements ICredentialType {
	name = 'getCourseTechApi';

	displayName = 'GetCourse API';

	documentationUrl = 'https://getcourse.ru/pl/postback/redoc';

	icon: Icon = {
		light: 'file:../icons/getcourse.svg',
		dark: 'file:../icons/getcourse.dark.svg',
	};

	properties: INodeProperties[] = [
		...accountAddressProperties,
		{
			displayName: 'School API Key',
			name: 'schoolApiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Ключ АПИ школы, one per account — the same value as the secret key under Профиль → Настройки аккаунта → АПИ. Every node in this package uses it. A read-only key is enough for reading; the GetCourse Legacy node needs one with write access to import.',
		},
		{
			displayName: 'Developer Key',
			name: 'developerApiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Ключ разработчика, needed by the GetCourse node and the Trigger and by nothing else. Issued to the integrator by GetCourse after the form at getcourse.ru/issuedeveloperkey, and it is the same key for every school you integrate. Leave it empty if you only import and export.',
		},
		{
			displayName: 'Requests per Second',
			name: 'requestsPerSecond',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 50 },
			default: 5,
			description:
				'A client-side throttle on the Tech API, not a documented platform limit. GetCourse publishes no rate for it, so this keeps a busy workflow from finding out where the ceiling is the hard way.',
		},
		{
			displayName: 'Export Requests per Hour',
			name: 'exportRequestsPerHour',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 50 },
			default: 45,
			description:
				'How many Export API calls the GetCourse Legacy node may make per hour. GetCourse allows 100 per two hours and counts every status check, so the default leaves room for a second workflow. Exceeding it answers 903 for everyone using the account.',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: ACCOUNT_BASE_URL,
			url: TEST_URL,
			// Sent on both branches: the legacy endpoint reads its key from exactly
			// this place, and `get-departments` was called with a `key` parameter on a
			// live account and answered `status: true` as though it were not there.
			qs: { key: '={{ $credentials.schoolApiKey }}' },
			// Attached here rather than by an `authenticate` block — see the class
			// comment. The legacy endpoint ignores a header it does not know.
			headers: { Authorization: TECH_BEARER },
			// Following a redirect here would test the wrong server: an account that
			// force-redirects answers with its own domain's HTML, which carries
			// neither `success` nor `status`, so the rules find nothing to object to
			// and the credential passes while the node cannot use it. A refused
			// redirect fails the test instead, which is the honest outcome.
			disableFollowRedirect: true,
		},
		rules: TEST_RULES,
	};
}
