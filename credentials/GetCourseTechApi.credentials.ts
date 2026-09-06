import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

import {
	accountAddressProperties,
	accountHostExpression,
	pinnedHttpRequestDomains,
} from './accountAddress';

/** The account host, assembled from the address fields. */
export const ACCOUNT_BASE_URL = `=https://{{ ${accountHostExpression('$credentials')} }}`;

/**
 * The Tech API bearer token: two keys glued with an underscore.
 *
 * GetCourse issues the two halves to different people — the developer key to the
 * integrator who filled in the form at getcourse.ru/issuedeveloperkey, the school
 * key by the school itself — so they are separate fields here. Splicing them into
 * one string is the documented format, not a convenience.
 */
export class GetCourseTechApi implements ICredentialType {
	name = 'getCourseTechApi';

	displayName = 'GetCourse Tech API';

	documentationUrl = 'https://getcourse.ru/pl/postback/redoc';

	icon: Icon = {
		light: 'file:../icons/getcourse.svg',
		dark: 'file:../icons/getcourse.dark.svg',
	};

	properties: INodeProperties[] = [
		...accountAddressProperties,
		{
			displayName: 'Developer Key',
			name: 'developerApiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Ключ разработчика. Issued to the integrator by GetCourse after the form at getcourse.ru/issuedeveloperkey. It is the same key for every school you integrate.',
		},
		{
			displayName: 'School API Key',
			name: 'schoolApiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Ключ АПИ школы. Handed out by the school itself, one per account. It is documented as a different key from the account Secret Key the legacy Import/Export API uses, but that Secret Key was accepted here on every account tried — so if the school cannot find a separate one, the Secret Key is worth pasting in before chasing support.',
		},
		{
			displayName: 'Requests per Second',
			name: 'requestsPerSecond',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 50 },
			default: 5,
			description:
				'A client-side throttle, not a documented platform limit. GetCourse publishes no rate for the Tech API, so this keeps a busy workflow from finding out where the ceiling is the hard way.',
		},
		pinnedHttpRequestDomains,
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.developerApiKey}}_{{$credentials.schoolApiKey}}',
			},
		},
	};

	/**
	 * `GET /common/get-departments` takes no parameters and touches no data, which
	 * makes it the safest probe. A wrong or unpaired key pair answers 403.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: ACCOUNT_BASE_URL,
			url: '/pl/api/v1/common/get-departments',
			// See the note on the account credential: a followed redirect turns a
			// wrong-address failure into a passing test against somebody else's page.
			disableFollowRedirect: true,
		},
	};
}
