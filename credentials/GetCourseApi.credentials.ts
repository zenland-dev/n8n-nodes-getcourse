import type { Icon, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

import { accountAddressProperties, accountHostExpression } from './accountAddress';

/** The account host, assembled from the address fields. */
export const ACCOUNT_BASE_URL = `=https://{{ ${accountHostExpression('$credentials')} }}`;

/**
 * The account's own API key — the one behind Профиль → Настройки аккаунта → АПИ.
 *
 * There is deliberately no `authenticate` block. GetCourse's Import/Export API
 * takes its key as an ordinary `key` field, in the POST body for imports and in
 * the query string for exports, and n8n's generic authenticator can express only
 * one of those. The transport puts the key where each call needs it instead,
 * which has the pleasant side effect that this credential cannot be selected in
 * an HTTP Request node and pointed at an unrelated host.
 */
export class GetCourseApi implements ICredentialType {
	name = 'getCourseApi';

	displayName = 'GetCourse Account API';

	documentationUrl = 'https://getcourse.ru/help/api';

	icon: Icon = {
		light: 'file:../icons/getcourse.svg',
		dark: 'file:../icons/getcourse.dark.svg',
	};

	properties: INodeProperties[] = [
		...accountAddressProperties,
		{
			displayName: 'Secret Key',
			name: 'secretKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Секретный ключ API аккаунта. Generate it in Профиль → Настройки аккаунта → АПИ. A read-only key is enough for exports and for reading the custom-field dictionary; imports need a key with write access.',
		},
		{
			displayName: 'Export Requests per Hour',
			name: 'exportRequestsPerHour',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 50 },
			default: 45,
			description:
				'How many Export API calls this account may make per hour. GetCourse allows 100 per two hours and counts every status check, so the default leaves room for a second workflow. Exceeding it answers 903 for everyone using the account.',
		},
	];

	/**
	 * `POST /pl/api/account/fields` is the cheapest call that proves the key works:
	 * it needs no filter, returns a small dictionary, and is not one of the export
	 * actions the 100-per-two-hours budget counts.
	 *
	 * The body is a pre-encoded string rather than an object because the endpoint
	 * only reads form fields, and an object would be sent as JSON.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: ACCOUNT_BASE_URL,
			url: '/pl/api/account/fields',
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: '=action=get&key={{ encodeURIComponent($credentials.secretKey) }}',
			// Following a redirect here would test the wrong server: an account that
			// force-redirects answers with its own domain's HTML, which carries no
			// `success` field, so the rule below finds nothing to object to and the
			// credential passes while the node cannot use it. A refused redirect
			// fails the test instead, which is the honest outcome.
			disableFollowRedirect: true,
		},
		rules: [
			{
				type: 'responseSuccessBody',
				properties: {
					key: 'success',
					value: false,
					message:
						'GetCourse refused the key. Check the secret key and the account address, and that the account is on a paid plan — the Import/Export API is switched off on the trial one. If the account redirects its GetCourse address to a domain of its own, switch this credential to Custom Domain: the API answers only on that domain.',
				},
			},
		],
	};
}
