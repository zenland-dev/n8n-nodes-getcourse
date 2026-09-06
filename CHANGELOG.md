# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[semantic versioning](https://semver.org/spec/v2.0.0.html) — with one addition that matters
more than the rest:

**A resource value, an operation value, a credential name or a node name is never renamed
in a minor release.** Those strings live inside other people's saved workflows, and changing
one silently breaks the workflow and detaches its credentials. When such a rename becomes
unavoidable it is a major version, and this file says exactly what to change and where.

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

[0.1.0]: https://github.com/zenland-dev/n8n-nodes-getcourse/releases/tag/0.1.0
