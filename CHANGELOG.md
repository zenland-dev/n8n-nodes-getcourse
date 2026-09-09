# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[semantic versioning](https://semver.org/spec/v2.0.0.html) — with one addition that matters
more than the rest:

**A resource value, an operation value, a credential name or a node name is never renamed
in a minor release.** Those strings live inside other people's saved workflows, and changing
one silently breaks the workflow and detaches its credentials. When such a rename becomes
unavoidable it is a major version, and this file says exactly what to change and where.
Below 1.0.0 that slot is the minor number, which is what semantic versioning reserves it for,
and a release that renames or removes anything says **action required** in its heading.

## [0.2.1] — 2026-09-10

### Changed — action required

- **One credential type, and it is the Tech API one.** 0.2.0 merged the two the wrong way
  round: it kept `getCourseApi` and carried the Tech keys into it, leaving three key fields
  where there are only two keys. `getCourseApi` is now gone and `getCourseTechApi` — shown as
  **GetCourse API** — is the only credential, carrying exactly the school key and the
  developer key. The GetCourse Legacy node uses the school key as its own: GetCourse
  documents «ключ АПИ школы» and the secret key under Профиль → Настройки аккаунта → АПИ
  separately, and on every account tried they are one value.

  **If you are on 0.1.0 or 0.2.0 and use the GetCourse Legacy node**, open it, select or
  create a **GetCourse API** credential and fill in the **School API Key** — the same value
  you had as the Secret Key. Credentials of type `getCourseTechApi` created in 0.1.0 keep
  working and only need that one field filled in to drive the Legacy node too.

  This ships as a patch rather than a minor release, against the rule at the top of this
  file, because it withdraws a change that stood for less than a day: relative to 0.1.0 it
  restores the credential type 0.2.0 removed.

## [0.2.0] — 2026-09-09

Superseded by 0.2.1 within a day: the credential merge went the wrong way round. Do not use
this version — 0.2.1 carries the same fixes.

### Changed — action required

- **The two credential types are now one.** Merged the wrong way round; see 0.2.1. Both APIs address the same account with the same four
  address fields, and the school key the Tech API asks for is, on every account tried, the
  account Secret Key the other credential already held — so filling all of it in twice bought
  nothing.

  **If you use the GetCourse node or the GetCourse Trigger**, open each of them after
  upgrading, select or create a **GetCourse API** credential, and fill in the **Developer
  Key** — n8n never hands a stored password back, so the keys have to be entered again. Leave
  **School API Key** empty unless your school issued one separately from the Secret Key.
  Workflows using only the GetCourse Legacy node are unaffected: that credential kept its
  name and its fields.

  Separating duties still works, and this is why both key fields are optional: a credential
  holding only a developer and a school key drives the GetCourse node and can export nothing,
  while one holding only the Secret Key drives the Legacy node.

### Fixed

- **The credential Test button.** On the Tech credential it refused with «This credential is
  configured to prevent use within an HTTP Request node» — the pinned Allowed HTTP Request
  Domains field, which on some n8n versions blocks the credential's own test as well as the
  HTTP Request node. The credential no longer declares an `authenticate` block at all, so n8n
  neither offers it in an HTTP Request node nor injects that field, and the transports attach
  their own authentication.
- **What a failed test says.** n8n reads a credential's `responseSuccessBody` rules only on a
  successful response, so every rejection arrived as a bare HTTP status — `Forbidden`,
  `Found`, `ENOTFOUND` — and the explanations written for them were unreachable. Both kinds of
  rule are now present, and a rejected key, a wrong address and an account that redirects to
  its own domain each say so.
- **A pasted account address.** Typing or pasting `myschool.getcourse.ru`, or the whole URL,
  into **Subdomain** silently became `myschoolgetcourseru` and failed to resolve. Everything
  from the first dot on is now dropped, as it always should have been.
- **An empty account address** made the test request `https://` and reported the single word
  `ENOTFOUND`. It now names an address that cannot resolve, so the message says what is wrong.

### Added

- **A picker for custom fields in the GetCourse node.** `Update Custom Fields` asked for a
  bare numeric field ID because the Tech API publishes no dictionary of them. It turns out
  `Get Custom Fields` is one: it answers keyed by field ID, carries the name beside each
  value, and lists every field the account defines rather than only the filled ones. The
  picker reads it from the user or the order the operation already names, so fill that
  identifier in first. Typing an ID by hand, or supplying one by expression, still works.

  The two endpoints behind it answer different shapes — the user one an object keyed by field
  ID, the order one a plain array — which is worth knowing if you read them yourself: the user
  operation emits a single item carrying every field, the order operation one item per field.

## [0.1.0] — 2026-09-06

First public release. The package was written against GetCourse's own documentation and
then reconciled against two live accounts, so where the documentation and the service
disagree, the code follows the service and says so in a comment at the point it matters.

### Added

- **GetCourse** node for the Tech API (`/pl/api/v1`): users, orders, offers, school
  dictionaries, dialogs, HelpDesk tickets, lessons, webinars, calls and event
  subscriptions.
- **GetCourse Legacy** node for the account Import/Export API: importing users and orders,
  changing an order's status, replacing a user's groups, the custom-field dictionary, the
  group list, and the four exports — users, group members, orders, payments.
- **GetCourse Trigger** node, taking events either from a GetCourse process using the
  «Вызвать URL» operation or from a Tech API `set-uri` subscription it manages itself.
- **GetCourse Account API** credential (the account secret key) and **GetCourse Tech API**
  credential (developer key plus school key), both able to address an account either by its
  GetCourse subdomain or by a custom domain.

### Notes

- The node interface carries Russian alongside English, which n8n's verification guidelines
  do not permit ("Both the node interface and all documentation must be in English only").
  That is a deliberate choice for now — GetCourse is a Russian-market platform — and it is
  reversible: descriptions are not identifiers, so translating them is a minor release that
  breaks nobody's workflow.
- Published from GitHub Actions with an npm provenance statement, which n8n has required of
  submitted nodes since 1 May 2026.

[0.2.1]: https://github.com/zenland-dev/n8n-nodes-getcourse/releases/tag/0.2.1
[0.2.0]: https://github.com/zenland-dev/n8n-nodes-getcourse/releases/tag/0.2.0
[0.1.0]: https://github.com/zenland-dev/n8n-nodes-getcourse/releases/tag/0.1.0
