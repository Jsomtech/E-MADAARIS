# E-MADAARIS

**Hal Nidaam, Dhammaan Baahiyaha Dugsiga** — one system for every school need.
Multi-tenant SaaS school management & digital learning platform by **JSOM TECH**.

| Layer | Stack |
| --- | --- |
| Client | React 18 + Vite, Bootstrap 5, Tailwind, React Router, Lucide, Chart.js, Axios, React Hook Form + Zod, React Toastify, i18next (EN / SO) |
| API | Node.js + Express 4, Zod validation, Helmet, rate limiting, Pino |
| Data | Supabase (PostgreSQL + Auth + Storage) with row-level security |

Repository layout:

```
client/          React app (public marketing site + 19 role dashboards)
server/          Express API (all writes go through here)
supabase/        migrations/0001…0025 + 0090_rls.sql, seed.sql
.env.example     every variable the app reads
```

---

## 1. Quick start

```bash
npm install                 # installs client + server workspaces
cp .env.example .env        # then fill in the Supabase values (see §2)
```

### 1.1 Database

Apply the SQL files **in sorted order** (the number prefix is the order):

1. `supabase/migrations/0001_core_helpers.sql` … `0027_notification_acks.sql` (0026 adds the Web Push
   subscriptions and device lifecycle to `push_tokens`, 0027 adds acknowledgments; both alter existing
   tables, so `0090_rls.sql` does not need re-running for them)
2. `supabase/migrations/0090_rls.sql` — enables RLS and installs the tenant-isolation policies (run after all tables exist, and again after adding a migration that creates one)
3. `supabase/seed.sql` — platform roles, permissions, subscription plans, reference data

Run them in the Supabase SQL editor or with the Supabase CLI:

```bash
supabase db push        # or paste each file in order
psql "$DATABASE_URL" -f supabase/seed.sql
```

`npm run db:migrate:print -w server` prints this same order for convenience.

### 1.2 Create the first Super Admin

`platform_roles` must be seeded first (step 1.1). Then set `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`
(minimum 8 characters) in `.env` and run:

```bash
npm run db:seed -w server
```

The script is idempotent: it creates (or reuses) the GoTrue user, links a `platform_users` row and
assigns the `super_admin` platform role. It never writes a plaintext password — the value you put in
`.env` is sealed into the credential vault (§5.1) so it can be read back from the console later, and
the password itself is never printed.

That makes this the way out of a locked console: set a password in `.env` that only you know, run
`npm run db:seed -w server`, sign in. Nothing secret has to pass through a chat log or a terminal
scrollback to get the account back.

### 1.3 Run

```bash
npm run dev        # API on :4000 + Vite on :5173
```

The API exposes `GET /health` (no DB required, reports whether Supabase credentials are configured).

---

## 2. Environment variables

All variables live in one repo-root `.env`; `server/src/config/env.js` loads it first and then
`server/.env` if present. The Vite client reads only `VITE_*`, from `client/.env`.

| Key | Used by | Notes |
| --- | --- | --- |
| `VITE_API_BASE_URL` | client | e.g. `http://localhost:4000/api/v1` |
| `PORT`, `NODE_ENV` | server | API port |
| `FRONTEND_URL`, `CORS_ORIGINS` | server | comma-separated allowed origins |
| `SUPABASE_URL` | server | project URL |
| `SUPABASE_ANON_KEY` | server | used for the user-scoped GoTrue client (sign-in, token refresh) |
| `SUPABASE_SERVICE_ROLE_KEY` | server | **server only** — never exposed to the browser |
| `CREDENTIALS_KEY` | server | optional; seals system-issued passwords (§5.1). Falls back to the service-role key, so set it explicitly and keep it stable |
| `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` | server | optional; blank = invitation links are logged instead of mailed |
| `PAYMENT_PROVIDER`, `PAYMENT_API_KEY`, `PAYMENT_WEBHOOK_SECRET` | server | optional; no gateway is simulated (see §6) |
| `APP_BASE_URL` | server | base URL used in invite/reset links |
| `JWT_AUDIENCE` | server | defaults to `authenticated` |
| `PLATFORM_SUPPORT_EMAIL` | server | shown on support pages |
| `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`, `SUPERADMIN_NAME` | server script | used only by `db:seed` |
| `FIREBASE_SERVICE_ACCOUNT_PATH`, `FIREBASE_PROJECT_ID` | server | push over FCM (see §8); the JSON itself stays out of the repo |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | server | the same JSON as one value, for hosts with no readable file (Vercel). Takes priority over the path — set one, not both |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | server | push over standards-based Web Push (§8.1b); mint both halves with `npm run push:vapid -w server` |
| `PUSH_TTL_SECONDS` | server | optional; how long a push service may hold an undelivered message (default 3600) |
| `CRON_SECRET` | server | only needed on a host without a persistent process: the bearer credential for `/api/v1/jobs/*` (§2.1) |
| `VITE_FIREBASE_*`, `VITE_FIREBASE_VAPID_KEY` | client | public web-app config that lets a device register for push |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | client | optional; makes the inbox fill itself without push (see §8.2) |

Without `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` the server still boots (so `/health` works) but
every database-backed route returns a configuration error.

### 2.1 Two ways to host the same API

`npm run start -w server` is the persistent form: it opens a port and arms three `setInterval`
schedulers (backups, closed elections, the notification queue). A serverless host has no process that
outlives a response, so `vercel.json` deploys `client/` as a Vite service and `server/` as an Express
service whose entrypoint is `server/api/index.js` — the same app, no `listen()`, no timers. The
schedulers become two cron-called routes, `POST|GET /api/v1/jobs/tick` (every 5 minutes: queued
notices, reminders, licence warnings, past-close elections) and `/api/v1/jobs/backups` (daily). They
take no session and accept only `Authorization: Bearer $CRON_SECRET`; without that variable they answer
503 rather than running unauthenticated.

---

## 3. Security model

These rules are enforced server-side and are not UI conveniences:

- **The service-role key never leaves the backend.** The browser only holds the user's own GoTrue
  access token; all data access goes through Express, which uses the service role and re-derives
  tenancy on every request.
- **Every protected request re-validates**: authenticated user → tenant membership → role/permission
  → subscription entitlement. Browser-supplied roles or `school_id` values are ignored.
- **Tenant isolation in the database.** `0090_rls.sql` enables RLS on every table carrying a
  `school_id` (plus bespoke policies for platform tables, notifications, support tickets, audit logs
  and storage) and installs a `tenant_isolation` policy keyed on the caller's school.
- **Hiding a menu is not access control.** Routes check `module.action` permissions
  (`req.auth.permissions` is a `Set`), and the API re-checks the same permission on every verb.
- **No plaintext secrets.** Passwords are handled by Supabase Auth; invitation tokens are generated
  by GoTrue (`generateLink({ type: 'invite' })`) and redeemed server-side. Nothing is stored as-is.
  The one deliberate exception is `server/src/services/credentialVault.js`: a password the *system*
  issued (student ID, admin-set staff password, Super Admin reset) is AES-256-GCM sealed into
  `auth.users.app_metadata.issued_credential` so it can be read back for the helpdesk. The seal is
  bound to `<schoolId>:<membershipId>`, and it is deleted the moment the owner changes their own
  password — a password somebody chose is never recoverable by anyone.
- **Audited operations.** Sensitive writes (users, roles, billing, settings, approvals, password
  changes) append to `audit_logs` with the actor, IP and summary. Reading a sealed password is
  audited too (`credential_viewed`) and answered with `Cache-Control: no-store`.
- **Expiry never deletes data.** Subscriptions move to `past_due` / `expired` and gate features and
  plan limits; school records are retained.
- **No payment gateway simulation.** Platform staff record manual payments (reference, method, date);
  a real provider is wired in only when credentials are present.

---

## 4. Roles and dashboards

Nineteen roles, each with its own landing dashboard (`/dashboard` redirects by primary role):

| Area | Roles | Landing route |
| --- | --- | --- |
| Platform | `super_admin`, `platform_support` | `/super-admin`, `/platform-support` |
| School leadership | `school_admin`, `principal`, `vice_principal`, `registrar` | `/school-admin`, `/principal`, `/vice-principal`, `/registrar` |
| Teaching & exams | `teacher`, `exam_officer`, `invigilator` | `/teacher`, `/exam-officer`, `/invigilator` |
| Finance | `accountant` | `/accountant` |
| Community | `student`, `parent` | `/student`, `/parent` |
| Staff functions | `librarian`, `hr_officer`, `receptionist`, `discipline_officer`, `transport_officer`, `lab_assistant` | `/staff/librarian`, `/staff/hr`, `/staff/reception`, `/staff/discipline`, `/staff/transport`, `/staff/lab` |

Shared authenticated pages: `/account`, `/notifications`, `/school/:section` (profile, users,
admissions, settings, subscription, audit, reports, id-cards, support, my-children, my-fees) and
`/m/:resource` — a config-driven CRUD screen for every registered module
(`client/src/config/resources.jsx`).

Subscription plans drive entitlement: `plan_features` toggles modules and limit values, and the CRUD
factory applies the plan caps (`max_students`, `max_staff`, `max_storage_mb`) on create.

---

## 5. API surface (prefix `/api/v1`)

| Router | Purpose |
| --- | --- |
| `auth` | login, refresh, logout, password reset/change, session profile, invite acceptance |
| `platform` | plans + plan features, school applications/approvals, schools, subscriptions, platform users/roles, support, sign-in helpdesk (§5.1) |
| `school` | dashboard builder, users & role assignment, roles list, settings, profile, reports (CSV), storage |
| `resources` | CRUD factory mounted for every school-scoped module (academic years, classes, subjects, students, staff, attendance, examinations, finance, library, learning, transport, certificates…) |
| `flows` | multi-step operations (results approval/publish, fee assignment, promotion, transfers, imports) |
| `attendance`, `finance`, `examinations` | domain-specific endpoints used by the dashboards |
| `school/notifications` | the inbox (`GET /`, `POST /read-all`, `POST /:id/read`, `GET /preferences`) plus the send operations behind it: `POST /preview`, `POST /send`, `GET /compose-options`, `GET /scheduled`, `POST /scheduled/:id/cancel`, `GET /batches/:batchId`, `GET /delivery-logs`, `GET /analytics`, and the acknowledgment pair `GET /pending-acks` / `POST /:id/ack` |
| `account` | the caller's own devices: `POST /push-token` + `/push-token/remove` (FCM), `POST /push-subscription` + `/push-subscription/remove` (Web Push), `GET /push-public-key` (the VAPID key a browser needs to subscribe), `GET /push-status`, `POST /push-test` (staff only, throttled) |
| `jobs` | the schedulers, for hosts without one: `GET`/`POST /tick` and `/backups`, bearer-protected by `CRON_SECRET` (§2.1) |

List endpoints return `{ data, total, page, pageSize }`; errors return
`{ error: { message, code?, details? } }`, and validation failures (422) carry
`details: [{ field, message }]`.

CSV reports: `GET /school/reports/{students|staff|payments|expenses|attendance-summary|discipline}`.
They require the bearer token, so the client downloads them as authenticated blobs
(`downloadFile()` in `client/src/api/client.js`).

### 5.1 Sign-in helpdesk

A school that cannot get in is a support call, and the operator answering it needs two things: a way
to read a password the system handed out, and a way to hand out a new one. These are the only routes
in the API that look across tenants, so they are Super Admin-only, every read is audited, and the
response is marked `no-store`.

| Endpoint | What it does |
| --- | --- |
| `GET /platform/schools/:id/users` | The tenant's accounts (`school_users` page), with `has_sign_in` instead of the auth id |
| `GET /platform/credentials/school-users/:id` | Reveal that person's issued password; a student still on their first sign-in reports their admission number |
| `POST /platform/credentials/school-users/:id/reset` | Set a password or `generate: true`; the account holder is asked to change it at next sign-in, and an inbox alert tells them it happened |
| `GET /platform/credentials/platform-users/:id` · `POST …/reset` | The same, for platform staff accounts |
| `GET /platform/credentials/me` · `POST /platform/credentials/me/password` | The signed-in operator's own password. Setting it here keeps a recoverable copy, because losing the only console account would lock the whole team out |

The rule the screens make explicit: **issued is readable, chosen is not.** Supabase stores a one-way
hash, so when nobody can reveal a password the answer is a reset, never a guess — and the reset is
deliberately flagged `must_change_password`. `POST /platform/users` takes the same split: leave
`password` out and it mails a 7-day activation link; supply one and the account works immediately and
its password shows up in the reveal dialog.

The `POST /platform/credentials/me/password` reply carries fresh session tokens: GoTrue revokes the
old session when the password changes, and `/auth/update-password` has always signed the user back in.
School-side passwords set by their owners keep clearing `issued_credential`, so they stay private.

---

## 6. Payments

There is no payment gateway integration. Platform staff record manual subscription payments against
an invoice; the school's subscription status and period are updated as part of that operation and the
action is audited. `PAYMENT_*` variables exist so a real provider can be added later without schema
changes — until they are set, nothing is charged or simulated.

---

## 7. Localisation

English and Somali UI: navigation, auth screens, module labels, statuses and shared chrome are
translated in `client/src/i18n/en.json` / `so.json`, and the notification stack — account page,
inbox, composer, delivery report and the school-settings automation card — is present in both.
Longer page bodies in older modules still use English `defaultValue` fallbacks, so Somali mode
shows English text for those blocks; extending the two locale files is the remaining work.

---

## 8. Notifications, device push and the PWA

One written record, up to three copies of it: `in_app` (the row in `/school/notifications`),
`push` and `email`. `server/src/services/notify.js` decides the channels from the recipient's own
preferences.

`push` is one system with two transports, chosen per device by `server/src/services/pushDelivery.js`:

| Transport | Reaches | Sender | Needs |
| --- | --- | --- | --- |
| FCM HTTP v1 | Chrome, Edge, Firefox and Samsung Internet on Android and desktop, when the app is installed | `server/src/services/fcm.js` (zero-dependency, talks to Google from the service-account JSON) | Firebase web config in `client/.env` |
| Web Push (RFC 8291 + VAPID RFC 8292) | Safari on an iPhone or iPad **added to the Home Screen**, and any browser without Firebase | `server/src/services/webpush.js` (`web-push`) | a VAPID pair in `.env` (§8.1b) |

A registration carries exactly one `PushManager` subscription, so a device is served by one transport
— iOS tries Web Push first, everything else tries FCM and falls back. The payload Web Push sends is
marked `provider: "webpush"`, and each half of `client/public/sw.js` only handles its own transport,
which is what makes a second notification for the same message impossible.

### 8.1a Server side: FCM

1. Run `supabase/migrations/0024_notification_email.sql` and
   `supabase/migrations/0025_notification_ops.sql` in the Supabase SQL editor. 0025 adds the
   delivery log tables, the inbox `priority` column, the queue for scheduled notices,
   `school_settings.notification_configuration`, the Realtime publication and the
   `notifications.send` / `notifications.export` grants. Every screen degrades without it — the
   priority filter is hidden, the automation card is locked, and the API answers 409 rather than
   writing to a column that is not there.
2. Point `FIREBASE_SERVICE_ACCOUNT_PATH` (or `GOOGLE_APPLICATION_CREDENTIALS`) at the
   service-account JSON you downloaded from Firebase Console → Project settings → Service
   accounts. Keep the file outside the repository; the server reads it at send time and never
   logs its contents. `FIREBASE_PROJECT_ID` is optional — the project id inside the JSON is used
   when it is blank. On a host with no readable file, put the same JSON in
   `FIREBASE_SERVICE_ACCOUNT_JSON` instead; it takes priority and is the only option that works
   on Vercel (§2.1).
3. Restart the API. `.env` is read once at boot, so `node --watch` reloading the code is not
   enough after you add the path.

### 8.1b Server side: Web Push and the two migrations

```bash
npm run push:vapid -w server      # writes VAPID_PUBLIC_KEY / _PRIVATE_KEY / _SUBJECT into .env
```

The script prints only the public key, because the public key is handed to every browser that
subscribes; the private half never leaves the file. Re-running it is a no-op on purpose: a rotated
pair silently invalidates every subscription already registered, because the push services then
answer 404 and each person's device goes quiet until they open the app again.

Then run these two files in the Supabase SQL editor, in order:

| Migration | Adds | Without it |
| --- | --- | --- |
| `0026_push_subscriptions.sql` | `provider`, `endpoint`, `p256dh`, `auth`, `label` on `push_tokens`; lifecycle columns `active`, `failure_count`, `last_error`, `revoked_at`; the unique `endpoint` the upsert needs; a partial index on live devices | the API still registers devices, but only over FCM, using the old column shape |
| `0027_notification_acks.sql` | `ack_required` and `acknowledged_at` on `notifications`, plus the index the acknowledgment prompt reads | the composer's "must be acknowledged" checkbox has no effect and `/notifications/pending-acks` answers `ready: false` |

Both are written so an un-migrated database keeps working: the first error mentioning a missing
column downgrades that process's writes to the old shape instead of failing the send. Restart the
API and rebuild the client (`npm run build -w client`) afterwards.

### 8.2 Client side

Copy `client/.env.example` to `client/.env` and fill it from Firebase Console → Project settings →
Your apps → Web app config, plus the Web Push certificate key in Cloud Messaging → Web
configuration. These are public identifiers that Vite bakes into the bundle, not secrets. Add
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` if you want the inbox to fill itself the moment a
message is written — the anon key only ever reaches rows the database's own policies let that user
read. Rebuild after editing: `npm run build -w client`.

Push is per device and per opt-in: a signed-in person turns it on from the Account page
(`push_tokens` stores the subscription against their school and user), and the browser must have
granted the notification permission. On a phone or desktop the app is installable as a PWA; the
service worker caches the app shell only, so a signed-out or stale API response is never served
from cache.

The lifecycle rules that keep that list honest are worth knowing before debugging it:

- **One row per browser, several browsers per person.** Each registration is stored under its own
  credential; the newest 20 per account are kept and older ones are retired so a new phone always
  fits.
- **A denied permission is never re-asked.** `client/src/services/push.js` reads
  `Notification.permission` first and refuses quietly if it is `denied`, so nobody is chased by a
  prompt they already said no to.
- **A refresh is an update, not a duplicate.** Chrome replaces a token that changes at runtime; the
  same credential upserts onto itself instead of adding a row.
- **Dead devices are retired, not deleted.** A 404/410 from a push service or `UNREGISTERED` from
  FCM sets `active = false` and `revoked_at`, leaving the delivery history intact. Twelve consecutive
  failures do the same. Deleting the row would orphan every log that names it.

### 8.2b iOS and Android, in plain terms

| Platform | What works | What to tell a user |
| --- | --- | --- |
| Android Chrome / Samsung Internet / Edge, installed as a PWA | FCM, so a message appears on the lock screen with the app closed | install the app, press *Enable on this device* |
| Desktop Chrome / Edge / Firefox | FCM where configured, otherwise Web Push | same |
| iPhone / iPad, Safari in a tab | **nothing** — iOS only delivers push to installed web apps | must go Share → **Add to Home Screen**, open the Home Screen icon once, then enable |
| iPhone / iPad, added to the Home Screen (iOS 16.4+) | Web Push, and it needs the VAPID pair from §8.1b | the Account page says so when the device is not eligible |

There is no way around the Home Screen requirement: it is an Apple limit, not an E-MADAARIS setting.

### 8.3 Who may send, and where to look for it

`notifications.send` is granted to school_admin, principal, teacher, accountant and exam_officer —
teachers and exam officers are limited to their own classes by the server. `notifications.export`
(delivery analytics naming every recipient) is school_admin and principal only.

| Screen | Route | What it does |
| --- | --- | --- |
| Inbox | `/school/notifications` | Filters by type, priority, date and text; opens the record a notice refers to; live feed when Supabase keys are set |
| Composer | `/school/send-notice` | Pick roles, classes or people, preview the audience, send now or queue, require an acknowledgment |
| Delivery report | `/school/notification-report` | Writes, reads, per-channel outcomes, push rejection codes, how many recipients acknowledged, and one send's log via `?batch=` |
| Account | `/account` | Push on/off for this device, which transport it registered over, password, language |
| School settings | `/school/settings` | "Automated notices": lesson reminders, lead minutes, assignment deadline lead, subscription alerts |

`server/src/services/notificationScheduler.js` reads those four switches on its sweep. The lesson
clock is the school's own `timezone`, so a period is announced at the right minute in Mogadishu
even though the API runs in UTC. A school that never switched reminders on costs one query and
nothing else.

**Mandatory announcements.** The composer's *must be acknowledged* option (`ack_required`) is
offered only when the in-app channel is on, and it means: the recipient's next visit to the app
raises a modal that cannot be dismissed (`client/src/components/notifications/AcknowledgmentGate.jsx`)
and only "I have read and understood" writes `acknowledged_at`. Being shown the message on a phone
lock screen is *not* an acknowledgment — the delivery log and the acknowledgment column are separate
facts, and a sender who has lost `notifications.send` before a queued notice is due cannot send it.

**Tapping a notification** opens the app at `/notifications?open=<id>`, which marks that one row read
and scrolls it into view. If nobody is signed in, `RequireAuth` remembers the exact URL, so the
person lands on the message after signing in — and only their own copy is ever marked read.

### 8.4 When a push does not go out

The composer's result and the delivery report show a skip reason instead of silence:

| Reason | What it means |
| --- | --- |
| `sender_not_configured` | Neither transport is usable — no service-account path and no VAPID pair |
| `no_registered_devices` | Those recipients have not pressed "Enable on this device" |
| `sender_credentials_rejected` | Firebase refused the key — the JSON was replaced or revoked |
| `token_lookup_failed` | The `push_tokens` read failed; the inbox rows were still written |
| `missing_school_scope` | A school-scope send arrived with no school to scope it to; refused rather than broadcast to every tenant |
| `push_threw` | The send itself raised; the message and the delivery log are unaffected |

`UNREGISTERED` in the rejection-code table means that browser was uninstalled, cleared or
re-registered; its token is dropped so the queue does not retry it forever. A Web Push 404/410 from
the push service means the same thing and retires the device the same way; a 5xx does not.

Each send records what it did per transport, so `/account` and the delivery report can say *2 via
FCM, 1 via Web Push* instead of a single number, and `GET /account/push-status` answers whether
either transport is configured at all before a sender is asked to press *Send test*.

### 8.5 What is proven, and what only a phone can prove

Verified automatically against the running code (`server/src/api/push.routes.js`,
`server/src/services/{pushDelivery,webpush,fcm,notify}.js`, `client/public/sw.js`):

- **Wire format.** A simulated browser subscription (its own P-256 key pair and auth secret) and an
  intercepted request showed the real thing leaving the server: an `aes128gcm` record that decrypts
  to exactly the notification JSON, a sender key in the record header, and nothing readable in
  transit without the subscription's keys.
- **Authorization.** The VAPID assertion is a `vapid t=…, k=…` header whose JWT is ES256-signed by
  the configured key, with `aud` set to that push service's origin, `sub` set to `VAPID_SUBJECT`,
  and `exp` about twelve hours ahead.
- **Priorities.** `urgent`/`high` → `Urgency: high`, `low` → `low`, unspecified → `normal`. The
  library accepts only those four levels, so `urgent` maps to the loudest one it takes rather than
  a value that would have failed the send.
- **Refusals.** A browser-supplied endpoint must be `https` on the standard port and must resolve to
  a public address: cloud-metadata, RFC-1918 and IPv6 loopback targets are rejected before any
  lookup of the device table, and in production so is a loopback test service on a dev port.
- **Tenancy.** Both recipient fields come from the verified session, never the body; a school-scope
  send without a school fails closed; routes are mounted behind authentication (anonymous and forged
  tokens both reach the auth layer).
- **Degradation.** With migrations 0026/0027 not yet applied, devices still register over the old
  column shape, `pending-acks` answers `ready: false`, and the ack prompt stays out of the way
  instead of raising a 500.

Not proven here, and it would be dishonest to call it working until someone does it:

1. **A message on a real lock screen.** Nothing in this repository can make that claim. Run §9's
   checks 1–4 and 13–16 on an Android phone and an iPhone added to the Home Screen.
2. **Apple's path end to end**, which additionally needs `VAPID_*` (§8.1b) and HTTPS with a
   certificate a phone trusts — `localhost` over plain http is not enough on iOS.
3. **iOS 16.4+ only.** An older iPhone cannot receive web push at all, in any product.

---

## 9. Testing the notification stack

Sixteen checks, in the order that builds on itself. Two of them (11 and 12) need a second browser;
13–16 need real phones, and they are the only ones that can answer the question the whole feature
exists for — does the message reach the device before the app is opened.

1. Signed-in school admin → Account → *Enable on this device*; `push_tokens` gains a row for that
   user and school, and the card says "Enabled on this device".
2. Composer → send a notice to one role with In-app and Push on; the inbox shows it immediately and
   the confirmation screen reports the same count as the audience preview.
3. Close the tab (PWA installed, API running) and send again; the operating system shows the
   notification with the subject and body.
4. Click that notification; the app opens on the page the notice linked to.
5. Inbox → preferences → switch `in_app` off for a category; a later notice in that category appears
   in neither the inbox nor as a push — the switch is the master.
6. Switch push off only; the inbox row is written and no browser alert fires.
7. Search, type, priority and date filters combined; paging past the last page returns to a page
   that exists rather than an error.
8. Schedule a notice for two minutes ahead; nothing is delivered until it is due, then recipients
   are counted again and the queue entry disappears.
9. Cancel a queued notice; no inbox row is written for it.
10. School settings → Automated notices: enable lesson reminders, set lead minutes; the sweep for
    that school matches its timetable entries at the school's own clock.
11. Second browser signed in as a teacher in the same school: with `VITE_SUPABASE_URL` /
    `VITE_SUPABASE_ANON_KEY` set, the bell fills without a refresh; with them blank, the message
    arrives on reload.
12. Delivery report as a role without `notifications.export` answers the permission state, not
    somebody else's recipient list; as principal, `?batch=<id>` isolates one send's per-channel
    outcomes.
13. **Android, app closed.** Install the PWA in Chrome, enable push, then send a notice to that
    person and lock the phone. The message must be readable on the lock screen without opening
    E-MADAARIS. Unlock and tap it: the app opens on that message and only that message becomes read.
14. **iPhone, added to the Home Screen** (iOS 16.4+, after §8.1b). Same as 13. In Safari a plain tab
    is expected to *not* receive anything — that is Apple's limit, recorded in §8.2b rather than
    hidden.
15. **No double notification.** With the app open in the foreground, send a notice: exactly one
    alert appears, the bell count rises by one, and the inbox shows the row once. Repeat with the
    tab closed and reopened.
16. **Acknowledgment is a person's act.** Send with *must be acknowledged* on, see it on the lock
    screen, and confirm the phone alone has not acknowledged it. Sign in on that device: the modal
    appears, cannot be dismissed, and only "I have read and understood" moves the delivery report's
    acknowledged count.

### 9.1 The standing automated checks

Five scratch probes cover what a machine can prove without a phone — the SSRF refusals in both
development and production mode, route mounting and authentication, the fan-out's tenancy rules, the
encrypted wire format with its VAPID assertion, and the behaviour of every new route against a
database that has not run 0026/0027 yet:

```bash
cd server
NODE_ENV=development node tmp-push-verify/probe-guard.mjs
NODE_ENV=production  node tmp-push-verify/probe-guard.mjs
node tmp-push-verify/probe-routes.mjs     # boots the real app on a spare port
node tmp-push-verify/probe-send.mjs
node tmp-push-verify/probe-wire.mjs
node tmp-push-verify/probe-degrade.mjs
```

They read nothing they should not and write nothing at all: two of them deliberately blank
`SUPABASE_URL` in their own process so a request can never reach the live database, and the wire
probe keeps its throwaway VAPID pair in memory instead of writing to `.env`. The directory is
gitignored (`server/tmp-*`), so these stay local verification rather than committed test fixtures —
delete it freely, it is described here so it can be rebuilt.

---

## 10. Deployment notes

- Build the client with `npm run build` and serve `client/dist` from any static host; point
  `VITE_API_BASE_URL` at the deployed API before building.
- Run the API with `npm start` (Node ≥ 18) behind TLS. Set `CORS_ORIGINS` to the exact frontend
  origin(s) and `FRONTEND_URL`/`APP_BASE_URL` to the public URL so invite and reset links resolve.
- Keep `SUPABASE_SERVICE_ROLE_KEY` in the server's secret store only.
- The public site is public; every `/api/v1` data route requires a valid session.
- Push and the service worker need HTTPS on the frontend origin (localhost is the one exception),
  so the PWA and *Enable on this device* do nothing over a plain `http://` LAN address.
- The two Firebase files live apart on purpose: the service-account JSON path stays in the
  server's secret store, while `client/.env` is compiled into the public bundle.

---

## 11. Troubleshooting

- **`npm install` fails with `EBADF` / `TAR_ENTRY_ERROR ... write`** — this happens when the project
  lives on a virtual/synced drive (e.g. Google Drive `G:`). Copy the repo to a local disk, run
  `npm install` there, or move the project off the synced volume.
- **`/health` returns `configured: false`** — `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are not
  set; database-backed routes will answer 503 until they are.
- **Login returns 503 `Server not configured`** — same cause; finish §2 first.
- **Push says `sender_not_configured`** — `FIREBASE_SERVICE_ACCOUNT_PATH` is blank, points at a
  file the server cannot read (always the case on Vercel — use `FIREBASE_SERVICE_ACCOUNT_JSON`),
  or was set after the last boot. `.env` is read once at start.
- **The bell does not fill by itself** — `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are unset
  (expected: the inbox refreshes on load instead), or the client bundle predates them — rebuild.
- **Priority filter is greyed out, or Automated notices says it needs migration 0025** — that
  database has not run `supabase/migrations/0025_notification_ops.sql` yet.
- **Reveal password answers "This person set their own password…"** — working as intended. Only a
  password the system issued has a sealed copy; use *Generate a new password* (§5.1) to give them a
  fresh one, which then stays readable until they change it themselves.
- **A new platform account got no activation email** — expected when the invite dialog was given a
  password: that account is ready to sign in immediately and its password is readable from the same
  screen. Leave the field blank to send the 7-day activation link instead.
- **Revealed passwords read back as blank after a server move** — the vault key is
  `sha256(CREDENTIALS_KEY || SUPABASE_SERVICE_ROLE_KEY)`. If both changed, old seals cannot be
  opened; reset those accounts. Set `CREDENTIALS_KEY` and keep it stable across deployments.

