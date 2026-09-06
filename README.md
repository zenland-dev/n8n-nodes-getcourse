# n8n-nodes-getcourse

n8n community nodes for [GetCourse](https://getcourse.ru) — the Russian online-school
platform — covering **both** of its APIs plus a webhook trigger.

GetCourse has two APIs that do not overlap and neither replaces the other:

| | **GetCourse** | **GetCourse Legacy** |
|---|---|---|
| API | Tech API, `/pl/api/v1/…` | Import/Export API |
| Docs | [redoc](https://getcourse.ru/pl/postback/redoc) | [help/api](https://getcourse.ru/help/api) |
| Keys | developer key **+** school key | the account's secret key |
| Creates | nothing | users, orders, payments |
| Bulk reads | offers, webinars, dictionaries — but never users or orders | users, orders, payments, group members |
| Single reads | users, orders, offers, dialogs, lessons, webinars | nothing |

So a real integration usually needs both: the Legacy node to create a user or export a
month of orders, the GetCourse node to read one order or move it to another status, and the
Trigger node to hear about it when something happens.

- [Installation](#installation)
- [Credentials](#credentials)
- [GetCourse node](#getcourse-node)
- [GetCourse Legacy node](#getcourse-legacy-node)
- [GetCourse Trigger](#getcourse-trigger)
- [Exporting data](#exporting-data)
- [Limits](#limits)
- [Data quirks worth knowing](#data-quirks-worth-knowing)
- [Feedback and bugs](#feedback-and-bugs)

## Installation

In n8n: **Settings → Community nodes → Install**, then enter
`n8n-nodes-getcourse`.

Self-hosted, from the command line:

```bash
npm install n8n-nodes-getcourse
```

Requires n8n 2.x and Node 20.19 or newer.

## Credentials

Both credentials address the account the same way. Pick **GetCourse Subdomain** and enter
the part in front of the domain — `myschool` for `myschool.getcourse.ru` — or, if your
account force-redirects that address to a domain of its own, pick **Custom Domain** and
enter that domain. The API answers only on the domain the account actually serves, and a
redirect is not followed: it would strip a POST body and hand the key to the other host.

### GetCourse Account API — for the Legacy node

One field: the account's **secret key**, from Профиль → Настройки аккаунта → АПИ. Generate
one with write access if you intend to import; a read-only key is enough for exports and
for the custom-field dictionary.

An import the account is not entitled to make does not say so. It comes back as HTTP 200 with
an empty body and creates nothing — no error code, no message. If you see «GetCourse answered
nothing at all», check the account's plan first and the key's write permission second: a key
that genuinely holds write access still fails this way on a plan without the Import API.

**Export Requests per Hour** (default 45) is a throttle this node applies on your behalf.
GetCourse allows an account 100 Export API requests per **two hours** in total, counting
every status check, and going over answers 903 for every other integration on that account
until the window clears. The default leaves room for a second workflow; lower it if the
account has other integrations, raise it if this n8n is the only caller.

The Import/Export API is available on paid plans only, and a plan that does not include it
does **not** announce itself with `error_code 917` the way the help page suggests. On a free
account with a write-enabled key, exports, the group list and the field dictionary all work
normally, while every import answers HTTP 200 with an empty body and writes nothing — no
code, no message. The node reports that as «GetCourse answered nothing at all» rather than
guessing. The Tech API is unaffected: the same account accepted Tech API writes with the
same key.

### GetCourse Tech API — for the GetCourse node and the Trigger

Two fields, because GetCourse issues the two halves to different people:

- **Developer Key** — issued to the integrator after
  [this form](https://getcourse.ru/issuedeveloperkey). The same key for every school you
  integrate.
- **School API Key** — handed out by the school itself, one per account. Not the same thing
  as the account Secret Key above.

The node joins them with an underscore and sends `Authorization: Bearer <developer>_<school>`,
which is the documented format. A 403 means one half is wrong, they belong to different
schools, or the school has not enabled access for that developer key.

## GetCourse node

The Tech API. Reads and updates existing objects; it creates nothing, and it cannot list
users or orders at all.

| Resource | Operations |
|---|---|
| **User** (25) | Get · Get by Chat ID · Get by Telegram Chat ID · Get Custom Fields · Get Deals · Get Purchases · Get Trainings · Get Schedule · Get Goals · Get Diplomas · Get Groups · Get Balance · Get Lesson Answers · Get Survey Answers · Get Dialogs · Get HelpDesk Dialogs · Update · Update Custom Fields · Add to Groups · Remove From Groups · Set Groups · Add Balance · Set Personal Manager · Create Diploma · Add Comment |
| **Order** (11) | Get · Get Custom Fields · Get Comments · Get Calls · Get Many Tags · Get Cancel Reasons · Update · Update Custom Fields · Add Positions · Remove Positions · Add Comment |
| **Offer** (3) | Get · Get Many · Get Many Tags |
| **School** (5) | Get Many Groups · Get Many Departments · Get Many Trainings · Get Many Personal Managers · Get Survey Answers |
| **Dialog** (5) | Add Comment · Add Note · Change Department · Close · Get History |
| **HelpDesk Ticket** (5) | Add Comment · Add Note · Change Department · Close · Get History |
| **Lesson** (3) | Get Many Answers · Add Comment to Answer · Set Answer Status |
| **Webinar** (5) | Get Many · Get Many by IDs · Add Comment · Moderate Comment · Moderate User |
| **Call** (2) | Set Description · Set Transcription |
| **Webhook** (2) | Subscribe · Unsubscribe |

Dropdowns read the live account wherever the API publishes a list: user groups, departments,
personal managers, offers, cancellation reasons and webinars. Where it publishes none —
lessons, surveys, products, diploma templates, custom fields — the field is a plain input and
says so.

There is no listing of users or of orders anywhere in this API, which is why the node has no
"Get Many Users": a user is reached by ID, e-mail, phone or messenger chat ID, an order by its
ID or through its buyer. Reading them in bulk is the Legacy node's export.

Two things the API does that are easy to be caught by, and which the node states in the
operation description rather than leaving to discovery:

- **Set Groups replaces the whole membership list.** Add to Groups and Remove From Groups
  are the incremental pair.
- **Call → Set Description and Set Transcription overwrite.** A second call replaces the
  text rather than appending to it, so a loop keeps only the last value.

### Naming a user

Most user operations take one of three identifiers, and the node asks which one you mean
rather than letting you fill in two and leaving the server to choose:

- **User ID** — unambiguous, and the only form every endpoint accepts;
- **Email** — when the ID is unknown;
- **Phone** — documented for the write endpoints and for Get. The other reads may ignore it
  and answer as though no user was named.

### Custom fields

The Tech API reads custom fields **by name** and writes them **by numeric ID**, and no
method in it lists those IDs. Use the Legacy node's **Custom Field → Get Many** to look
them up once; the ID is stable.

## GetCourse Legacy node

The account Import/Export API.

| Resource | Operation | What it does |
|---|---|---|
| **User** | Import | Creates the person, or updates them when **Update Existing** is on. Groups given here are added to the ones they are already in. |
| | Replace Groups | Sets the whole membership list — every group not named is removed. Needs the numeric user ID. |
| **Order** | Import | Creates the order and the buyer with it. Repeating it with the same order number edits that order instead. |
| | Set Status | Moves an existing order to another status. |
| **Export** | Export and Wait | Starts the job, waits for GetCourse to build the file, returns the rows. |
| | Start | Returns the export ID only. |
| | Check Status | Whether the file is ready, its column list and its row count — without the rows. |
| | Get Result | The rows of a finished export, or a report that it is still building. |
| **Group** | Get Many | Every group in the account, with its ID and when someone was last added. Answers directly, with no export job. |
| **Custom Field** | Get Many | The custom-field dictionary: ID, title, type and the entity each field belongs to. The only listing either API publishes. |

### Importing an order

The minimum GetCourse accepts is the buyer's e-mail plus **either** an Offer ID **or** an
offer code (or product title) together with an amount. Editing an existing order needs the
order number as well. An order carries one offer per request: to add a second, import again
with the same order number and **Append Offers** switched on.

An import is metered. Creating objects counts against a monthly allowance that depends on
the account plan; updating them does not. GetCourse says plainly that this API is for
importing data, not for reacting to things — for that, use the Trigger.

## GetCourse Trigger

GetCourse has two unrelated webhook systems, and the trigger's **Source** picks between
them.

### Source: GetCourse Process

Works on any paid account and needs no developer key. Copy the node's webhook URL, then in
GetCourse create a process with the **«Вызвать URL»** operation pointing at it — method
POST, body `json` or `x-www-form-urlencoded`.

There is **no fixed payload**: the field names and the field set are whatever the person
configuring the process types in, built from placeholders like `{object.email}` in a user
process and `{object.user.email}` in an order process. The node therefore passes the body
through unchanged and validates nothing.

### Source: Tech API Subscription

The node subscribes itself through `POST /set-uri` when the workflow is activated and
unsubscribes when it is deactivated. Pick one **Event Object** and the events under it.

One node listens to one event object on purpose. An Входящие message and a HelpDesk message
arrive as byte-for-byte identical bodies — same `event_id`, same `dialog_id` field name,
same everything — so the only thing that can tell them apart is which subscription
delivered them. Splitting by object keeps every delivery attributable, and the node fills
in an `eventType` accordingly.

The subscription belongs to the developer key, not to the workflow: deleting the node
without deactivating it first leaves GetCourse posting into a dead URL.

### Verifying deliveries

GetCourse signs nothing it sends, over either mechanism: if the address leaks, anyone can
post to it.

For **GetCourse Process** there is something to be done about that. Under **Verification**
the node can require a shared secret in a header or a query parameter, and answers 403
without starting the workflow when it is missing — add the same header in the «Вызвать URL»
settings of the process.

For a **Tech API Subscription** there is not. GetCourse composes the delivery itself and
sends a body and nothing else, so no secret of yours can be attached to it and the setting is
not offered. The URL is the only thing keeping those events private.

Nor can a subscription be tested with n8n's **Listen for test event**: `set-uri` holds one
address per event, so subscribing the temporary test URL would replace the live one and
unsubscribing it afterwards would take the running workflow off the air. The node refuses
that rather than doing it. Activate the workflow to receive real events.

## Exporting data

An export is asynchronous: one call starts the job and returns an ID, a second call either
says "not ready" or hands over the whole table. The node offers that as one operation or as
three, and both shapes are legitimate.

**One node.** *Export → Export and Wait* does the lot. Simple, and right for a nightly
report — but it holds the execution open while it waits, and a restart of n8n loses the
wait.

```
[GetCourse Legacy]  Export → Export and Wait  →  one item per row
```

**Three nodes.** *Start*, then an n8n **Wait** node, then *Get Result*. The wait costs no
execution time and survives a restart, which is what a large export needs. Set *Get
Result*'s **On Not Ready** to *Return Status* and an IF node can loop back:

```
[Start] → export_id
    ↓
[Wait 30s]
    ↓
[Get Result]  On Not Ready: Return Status
    ↓
[IF ready == false] ──yes──→ back to [Wait 30s]
    │ no
    ↓ one item per row
```

*Check Status* exists for a chain that wants an explicit readiness step. It is honest about
its cost: checking and fetching are the same request underneath, so a Check-then-Get chain
spends one request more per loop than *Get Result* alone.

An export needs **at least one filter** — GetCourse refuses to build a file without one,
and an account-wide export of a school with years of history is tens of megabytes. Split
long periods into several runs.

Whenever *Export and Wait* gives up or fails part-way through — the file is still building,
or the account's request budget ran out mid-poll — the error names the export ID. Nothing is
lost: the job goes on building on GetCourse's side, and a *Get Result* with that ID collects
it later, in this run or a later one. That matters because there is no method that lists
exports, so an ID nobody wrote down cannot be recovered.

### Dates and timezones

Filter dates are sent as whole days, worked out in the **workflow's** timezone — the one
n8n shows in the workflow settings, not the account's. A school in a different zone can see
the boundary fall a few hours out; set the workflow timezone to the school's to line them up.

A date written the Russian way, `01.03.2026`, is read as the first of March. That has to be
said because the obvious implementation gets it wrong: JavaScript's own parser reads the same
string as the third of January, and only for the first twelve days of a month — from the
thirteenth it fails instead. Anything the node cannot read with certainty is refused by name
rather than guessed at, because an export whose filter is ignored returns the whole account.

### The shape of the result

GetCourse answers with a table, not a list of objects: a column list and an array of arrays.
The node zips them, one output item per row. The column set is account-specific — every
custom field is spliced into the middle of the row — so nothing may be read by position.

Column titles are mostly Russian, with spaces and punctuation: `$json["Создан"]`,
`$json["ID партнера"]`. A few arrive in Latin — `utm_source`, `VK-ID`, and the five
`gc_system_user_utm_*` fields GetCourse adds to every account. Set **Options → Column
Names → Transliterated** to get `sozdan` instead, at the cost of exactness. An export whose
filter matches nothing is not an error: it returns the full column list and no rows, so the
node emits no items. Every cell arrives as a string, including money in Russian format
(`12 000,00`, sometimes with a non-breaking space) — the node does not coerce.

## Limits

| | |
|---|---|
| Export API | **100 requests per two hours per account**, status checks included. One export at a time per account. |
| Import API | A monthly allowance on **creating** objects, set by the account plan. Updates do not count. |
| Tech API | No published rate limit. The credential throttles to 5 requests per second by default as a precaution. |

The export budget is enforced by this package across the whole n8n process, per account
host, so several workflows hitting one account add up to one budget rather than racing.

The one-export-at-a-time rule deserves planning for rather than reacting to. It is
account-wide, so anything else exporting from the same school holds it — on a busy account
with other integrations, a start refused with «Уже запущен один экспорт» is the normal case,
not the rare one. Give the Export node a single item, or loop items through a Wait node, and
turn on **Settings → On Error → Continue** so a refusal does not discard the export IDs
earlier items already returned.

## Data quirks worth knowing

Observed in the wild rather than documented. The nodes do not silently correct any of them.

- A set-uri delivery arrives **wrapped**: `{"json": { … }}`. The trigger unwraps it, so
  `$json.deal.status` is what you write, not `$json.json.deal.status`.
- `deal.isPayed` in a webhook is sometimes `0`/`1` and sometimes a boolean — and is `0` in a
  `dealPaid` event even for a priced order that was just marked paid, not only for a free one.
- **`ts` is not the event's time.** It is the order's `createdAt`, and it is identical in
  every delivery about that order however far apart the events were — four events minutes
  apart all carried one `ts`. Do not deduplicate or order on it.
- **`ts` is not UTC either, despite ending in `Z`.** It is the account's local time with a
  `Z` appended: an account three hours ahead sent `10:52:21Z` with a `ts64` of `1788681141`,
  which is `07:52:21Z`. Use `ts64` when the real instant matters.
- `deal.status` takes the literal string `"false"`, which is GetCourse's «Ложный» status.
- `deal.payedValue` can be fractional and **less** than `cost` while the status is `payed`.
- `answer.id` arrives as a string with single quotes inside it: `"'501283094'"`.
- `comment.files` is a **string containing JSON** and needs parsing.
- `additional_fields[].required` is sometimes a boolean and sometimes the string `"1"`.
- A paid order fires **both** `dealPaid` and `dealStatusChanged` — confirmed on a live
  account, as two separate deliveries whose bodies differ in `eventType` and nothing else.
  Deduplicate if you act on both.
- Deliveries carry **no signature and no authentication header of any kind**, and they arrive
  from more than one address — two different source IPs across four consecutive events — so
  neither a shared secret nor an IP allowlist is available. The secrecy of the URL is the
  only thing protecting a subscription.
- Export cells are always strings, dates as `YYYY-MM-DD HH:MM:SS` in the account's timezone.

## Compatibility

Built against n8n 2.x with `@n8n/node-cli`. No runtime dependencies.

## Feedback and bugs

Bug reports and ideas are welcome — open an issue:
[github.com/zenland-dev/n8n-nodes-getcourse/issues](https://github.com/zenland-dev/n8n-nodes-getcourse/issues).

What makes a report quick to act on:

- your n8n version and the version of this package;
- which node — GetCourse, GetCourse Legacy or the Trigger — and which operation;
- what GetCourse answered. It likes to reply `200 OK` with `success: false`, so the body
  matters more than the status code; strip the keys before pasting it;
- for an export, the export id and whether it ever left the `processing` state;
- for the trigger, the source — a GetCourse process or a Tech API subscription — and one
  sample payload with the personal data removed.

GetCourse's own quirks are collected in [Data quirks worth knowing](#data-quirks-worth-knowing);
if you hit a new one, it belongs in an issue too — the list grows from them.

## License

[MIT](LICENSE.md)
