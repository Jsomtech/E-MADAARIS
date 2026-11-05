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

1. `supabase/migrations/0001_core_helpers.sql` … `0025_notification_ops.sql`
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
assigns the `super_admin` platform role. It never stores a plaintext password.

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
| `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` | server | optional; blank = invitation links are logged instead of mailed |
| `PAYMENT_PROVIDER`, `PAYMENT_API_KEY`, `PAYMENT_WEBHOOK_SECRET` | server | optional; no gateway is simulated (see §6) |
| `APP_BASE_URL` | server | base URL used in invite/reset links |
| `JWT_AUDIENCE` | server | defaults to `authenticated` |
| `PLATFORM_SUPPORT_EMAIL` | server | shown on support pages |
| `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`, `SUPERADMIN_NAME` | server script | used only by `db:seed` |
| `FIREBASE_SERVICE_ACCOUNT_PATH`, `FIREBASE_PROJECT_ID` | server | push over FCM (see §8); the JSON itself stays out of the repo |
| `VITE_FIREBASE_*`, `VITE_FIREBASE_VAPID_KEY` | client | public web-app config that lets a device register for push |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | client | optional; makes the inbox fill itself without push (see §8.2) |

Without `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` the server still boots (so `/health` works) but
every database-backed route returns a configuration error.

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
- **Audited operations.** Sensitive writes (users, roles, billing, settings, approvals, password
  changes) append to `audit_logs` with the actor, IP and summary.
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
| `platform` | plans + plan features, school applications/approvals, schools, subscriptions, platform users/roles, support |
| `school` | dashboard builder, users & role assignment, roles list, settings, profile, reports (CSV), storage |
| `resources` | CRUD factory mounted for every school-scoped module (academic years, classes, subjects, students, staff, attendance, examinations, finance, library, learning, transport, certificates…) |
| `flows` | multi-step operations (results approval/publish, fee assignment, promotion, transfers, imports) |
| `attendance`, `finance`, `examinations` | domain-specific endpoints used by the dashboards |
| `school/notifications` | the inbox (`GET /`, `POST /read-all`, `POST /:id/read`, `GET /preferences`) plus the send operations behind it: `POST /preview`, `POST /send`, `GET /compose-options`, `GET /scheduled`, `POST /scheduled/:id/cancel`, `GET /batches/:batchId`, `GET /delivery-logs`, `GET /analytics` |

List endpoints return `{ data, total, page, pageSize }`; errors return
`{ error: { message, code?, details? } }`, and validation failures (422) carry
`details: [{ field, message }]`.

CSV reports: `GET /school/reports/{students|staff|payments|expenses|attendance-summary|discipline}`.
They require the bearer token, so the client downloads them as authenticated blobs
(`downloadFile()` in `client/src/api/client.js`).

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

## 8. Notifications, Firebase push and the PWA

One written record, up to three copies of it: `in_app` (the row in `/school/notifications`),
`push` (Firebase Cloud Messaging HTTP v1) and `email`. `server/src/services/notify.js` decides the
channels from the recipient's own preferences; `server/src/services/fcm.js` is a zero-dependency
sender that talks to Google straight from the service-account JSON.

### 8.1 Server side

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
   when it is blank.
3. Restart the API. `.env` is read once at boot, so `node --watch` reloading the code is not
   enough after you add the path.

### 8.2 Client side

Copy `client/.env.example` to `client/.env` and fill it from Firebase Console → Project settings →
Your apps → Web app config, plus the Web Push certificate key in Cloud Messaging → Web
configuration. These are public identifiers that Vite bakes into the bundle, not secrets. Add
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` if you want the inbox to fill itself the moment a
message is written — the anon key only ever reaches rows the database's own policies let that user
read. Rebuild after editing: `npm run build -w client`.

Push is per device and per opt-in: a signed-in person turns it on from the Account page
(`push_tokens` stores the token against their school and user), and the browser must have granted
the notification permission. On a phone or desktop the app is installable as a PWA; the service
worker caches the app shell only, so a signed-out or stale API response is never served from
cache.

### 8.3 Who may send, and where to look for it

`notifications.send` is granted to school_admin, principal, teacher, accountant and exam_officer —
teachers and exam officers are limited to their own classes by the server. `notifications.export`
(delivery analytics naming every recipient) is school_admin and principal only.

| Screen | Route | What it does |
| --- | --- | --- |
| Inbox | `/school/notifications` | Filters by type, priority, date and text; opens the record a notice refers to; live feed when Supabase keys are set |
| Composer | `/school/send-notice` | Pick roles, classes or people, preview the audience, send now or queue |
| Delivery report | `/school/notification-report` | Writes, reads, per-channel outcomes, push rejection codes and one send's log via `?batch=` |
| Account | `/account` | Push on/off for this device, password, language |
| School settings | `/school/settings` | "Automated notices": lesson reminders, lead minutes, assignment deadline lead, subscription alerts |

`server/src/services/notificationScheduler.js` reads those four switches on its sweep. The lesson
clock is the school's own `timezone`, so a period is announced at the right minute in Mogadishu
even though the API runs in UTC. A school that never switched reminders on costs one query and
nothing else.

### 8.4 When a push does not go out

The composer's result and the delivery report show a skip reason instead of silence:

| Reason | What it means |
| --- | --- |
| `sender_not_configured` | No service-account path on the server, or it failed to parse |
| `no_registered_devices` | Those recipients have not pressed "Enable on this device" |
| `sender_credentials_rejected` | Firebase refused the key — the JSON was replaced or revoked |
| `token_lookup_failed` | The `push_tokens` read failed; the inbox rows were still written |
| `push_threw` | The send itself raised; the message and the delivery log are unaffected |

`UNREGISTERED` in the rejection-code table means that browser was uninstalled, cleared or
re-registered; its token is dropped so the queue does not retry it forever.

---

## 9. Testing the notification stack

Twelve checks, in the order that builds on itself. Two of them (11 and 12) need a second browser.

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
  file the server cannot read, or was set after the last boot. `.env` is read once at start.
- **The bell does not fill by itself** — `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are unset
  (expected: the inbox refreshes on load instead), or the client bundle predates them — rebuild.
- **Priority filter is greyed out, or Automated notices says it needs migration 0025** — that
  database has not run `supabase/migrations/0025_notification_ops.sql` yet.

