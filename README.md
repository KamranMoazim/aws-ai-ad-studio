# AdStudio

Branded AI ad creative for display and Meta ads, on AWS.

AdStudio is a white-labelled web app where an agency's clients sign in and produce ready-to-upload ads in 8 sizes, either from a locked template or from their website. Agency staff manage clients, templates, pricing and permissions in an admin area. One deployment serves one agency, in the agency's own AWS account.

> Built in phases. Phase 1 (this commit) is the foundation: storage, invite-only sign-in, roles and permissions, the API skeleton and the branded app shell.

## How it works (phase 1)

1. **Branding.** The Super Admin sets the app name, logo and colors in Settings. The sign-in page and the shell read them from the public `GET /branding`, so clients never see "AdStudio".
2. **Invite only.** Admins create users; there is no self sign-up. Cognito emails a temporary password (the CustomMessage trigger puts the app name in it), and the user picks a new password on first sign-in. The web app uses Amplify Auth with SRP, so the password never leaves the browser.
3. **Roles are data.** A role is a DynamoDB item with a list of grants (`actions` + `scope`). Saving a role generates one Cedar policy per grant in Amazon Verified Permissions. No deploy is needed to add or change a role.
4. **Every request is checked.** The HTTP API validates the Cognito access token, then the API loads the user's roles and staff assignments (cached 60 s per Lambda instance) and asks Verified Permissions. Lists are filtered through `BatchIsAuthorized`, and a client the caller can't read returns 404, not 403.
5. **Every write is audited** to `AUDIT#<yyyy-mm>`.

## Roles and scopes

| Role | Type | Grants |
| --- | --- | --- |
| Super Admin | staff | everything, `all` |
| Admin | staff | clients, staff assignment, client-user invites, projects, brand kits, templates, `all`. No users, roles, settings or pricing |
| Account Manager | staff | templates `all`; clients, client-user invites, projects, brand kits `assigned` |
| Client Owner | client | own client, projects, brand kits, transactions, invite client users, `own` |
| Client User | client | own client, projects, brand kits, `own` |

Scopes become Cedar conditions:

- `all`: none
- `assigned`: `resource.client in principal.assignedClients`
- `own`: `resource.client == principal.client`

Staff roles may use `all` or `assigned`; client roles only `own`. The schema and the full action list live in `backend/src/authz/schema.ts`.

## Single-table design (phase 1 items)

Table `adstudio`, on demand, `PK`/`SK`, `GSI1PK`/`GSI1SK`, TTL on `expiresAt`.

| Entity | PK | SK | GSI1PK / GSI1SK |
| --- | --- | --- | --- |
| Settings | `ORG` | `SETTINGS` | |
| Role | `ORG` | `ROLE#<roleId>` | |
| User | `USER#<sub>` | `META` | `USERS` / `<type>#<name>` |
| Client | `CLIENT#<id>` | `META` | `CLIENTS` / `<status>#<name>` |
| Client member | `CLIENT#<id>` | `MEMBER#<sub>` | `USER#<sub>` / `CLIENT#<id>` |
| Staff assignment | `CLIENT#<id>` | `STAFF#<sub>` | `USER#<sub>` / `CLIENT#<id>` |
| Audit entry | `AUDIT#<yyyy-mm>` | `<ts>#<id>` | `USER#<sub>#AUDIT` / `<ts>` |

## Stack

TypeScript end to end, Node.js 24 on arm64 Lambda, AWS CDK (one `AdStudioStack`), DynamoDB, S3, Cognito, Verified Permissions, API Gateway HTTP API + Hono, CloudFront, React + Vite. Region `us-east-1`.

## Quick start

Prerequisites: an AWS account in `us-east-1` with CDK bootstrapped, and Node.js 24.

```bash
npm run install:all
cp infra/.env.example infra/.env          # optional: APP_NAME used before branding is set
npm run infra:deploy                      # builds the client and deploys; writes infra/cdk-outputs.json
npm run bootstrap -- you@example.com      # seeds the 5 roles and invites you as Super Admin
```

Open the `SiteUrl` output and sign in with the temporary password from the email. Set `ADSTUDIO_PASSWORD` before `bootstrap` to skip the email and set a password directly. `npm run bootstrap -- you@example.com --reset-roles` rewrites the 5 starting roles and their policies.

Cognito's default email sender is limited to 50 emails a day. Branded email through SES is planned for a later phase.

Local development: `npm run client:config` writes `client/public/config.json` from the deployed stack, then `npm run client:dev` (and optionally `npm run api:dev`, with `API_URL=http://localhost:4000 npm run client:config`).

## API

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/health`, `/branding` | public |
| `GET` | `/me` | signed in; returns the user and allowed org-level actions |
| `GET` / `PUT` | `/settings` | `settings:manage` |
| `POST` | `/settings/logo-upload-url` | `settings:manage`; presigned PUT, PNG/JPG/WebP up to 1 MB |
| `GET` | `/users` | `user:manage`, or `?clientId=` with `user:invite` on that client |
| `POST` | `/users` | `user:manage`, or `user:invite` on the client for client users |
| `PUT` | `/users/:id` | same as above; name, roles, enable/disable |
| `GET` | `/roles` | signed in |
| `PUT` | `/roles/:id` | `role:manage`; regenerates the role's policies |
| `GET` / `POST` | `/clients` | filtered by `client:read` / `client:create` |
| `GET` / `PUT` | `/clients/:id` | `client:read` / `client:update` (+ `payment:toggle`, `client:archive`) |
| `GET` / `PUT` | `/clients/:id/staff-options`, `/clients/:id/staff` | `client:assign-staff` |

## Tests

```bash
npm run typecheck
npm run backend:test     # offline: keys and schemas, Cedar policy matrix via cedar-wasm
npm run infra:test       # synthesizes the stack and asserts on the template
npm run test:live        # against the deployed stack (needs bootstrap first)
```

- **Policy matrix:** every role x action x resource (own, assigned, other client, org, template) is evaluated with the real Cedar engine against the strict schema, and compared with an independent reading of the role grants. `test:live` runs the same matrix against the deployed policy store.
- **Flow (live):** a Super Admin creates two clients, invites a staff user and a client user, assigns the staff user to client A; the staff user sees A only and gets 404 on B; the client user sees only their client and can't edit it, list users or read settings. Test users and clients are removed afterwards.
- **Infra:** invite-only pool, SRP only for the web client, 15-minute access tokens, strict policy store, only `/health` and `/branding` public, private encrypted buckets, Node 24 arm64, no VPC or NAT.

## Build log

| Phase | What |
| --- | --- |
| 1 | Foundation and auth: table, buckets, Cognito invites, Verified Permissions with 5 roles, API skeleton, branded shell |

## Tear down

```bash
npm run teardown    # cdk destroy, then deletes leftover log groups and local outputs
```

Everything the stack creates (table, buckets, user pool, policy store, logs) is removed with it.
