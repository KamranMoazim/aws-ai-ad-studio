# AdStudio

Branded AI ad creative for display and Meta ads, on AWS.

AdStudio is a white-labelled web app where an agency's clients sign in and produce ready-to-upload ads in 8 sizes, either from a locked template or from their website. Agency staff manage clients, templates, pricing and permissions in an admin area. One deployment serves one agency, in the agency's own AWS account.

> Built in phases. Phase 1 is the foundation (storage, invite-only sign-in, roles and permissions, the branded shell). Phase 2 adds templates: the shared template model, the Konva renderer, the admin template builder, lint and publishing. Phase 3 adds the client side: uploads, brand kits, the 8-size ad editor, server-side export and the archive. Phase 4 adds payments: prices, Stripe Checkout, webhooks, transactions, refunds and emailed download links. Phase 5 adds the website scan: URL in, reviewed brand kit out. Phase 6 adds AI ad generation and AI image helpers.

## How it works (phase 1)

1. **Branding.** The Super Admin sets the app name, logo and colors in Settings. The sign-in page and the shell read them from the public `GET /branding`, so clients never see "AdStudio".
2. **Invite only.** Admins create users; there is no self sign-up. Cognito emails a temporary password (the CustomMessage trigger puts the app name in it), and the user picks a new password on first sign-in. The web app uses Amplify Auth with SRP, so the password never leaves the browser.
3. **Roles are data.** A role is a DynamoDB item with a list of grants (`actions` + `scope`). Saving a role generates one Cedar policy per grant in Amazon Verified Permissions. No deploy is needed to add or change a role.
4. **Every request is checked.** The HTTP API validates the Cognito access token, then the API loads the user's roles and staff assignments (cached 60 s per Lambda instance) and asks Verified Permissions. Lists are filtered through `BatchIsAuthorized`, and a client the caller can't read returns 404, not 403.
5. **Every write is audited** to `AUDIT#<yyyy-mm>`.

## Templates (phase 2)

A template is JSON, not an image. One document holds the slots (what clients and AI may fill), the color roles, one layout per size, and sample content. The same document drives the builder now, and the client editor, AI filling and the server renderer in later phases.

- **`shared/`** has no npm dependencies and is imported by the backend and the client: sizes, types, structure validation, lint rules, text fitting, cover/contain crop, contrast, adapt-to-sizes and the 3 seed templates.
- **One text layout.** `fitText` wraps and shrinks text (from the designed size down to `minFontSize`, or clamps to `maxLines` with an ellipsis). The renderer draws the lines it returns with wrapping off, so any canvas that loads the same fonts lays text out the same way.
- **Renderer** (`client/src/renderer`): `react-konva` scene per size, bundled fonts (Inter, Montserrat, Poppins, Playfair Display, Oswald), cover crop around a focal point, placeholder boxes for empty image slots, and the 9:16 safe-zone overlay.
- **Builder**: 8 live thumbnails with lint badges, drag/resize/rotate on the canvas, layers (add, reorder, hide, delete), properties (slot binding, frame, font, colors by role or fixed hex, fit, crop, locks), slots and color roles, sample content with per-size overrides and sample image uploads, and "adapt to all sizes".
- **Lint** runs in the browser with real fonts: required slots placed at every size, text in the 1080x1920 no-go area (margins from Settings, default top 14%, bottom 35%, sides 6%), contrast below 4.5:1 (warning), overflow with the sample copy and with copy at each size's `maxChars`, sample copy over `maxChars`, and a JPEG at quality 60 over 150 KB for display sizes.
- **Publish** needs a lint report with no errors for the saved revision. The API runs the geometric checks again itself, then writes an immutable version (`templates/<id>/v<n>.json` in S3, `TPL#<id>` / `V#<n>` in the table). Projects will pin a version, so later edits never change past ads. Publishing an unchanged draft again is refused.

Template drafts and versions live in S3 (bodies) and DynamoDB (metadata):

| Entity | PK | SK | GSI1PK / GSI1SK |
| --- | --- | --- | --- |
| Template | `TPL#<id>` | `META` | `TPLS#<status>` / `<channel>#<name>` |
| Template version | `TPL#<id>` | `V#<n>` | |

## Client editor and export (phase 3)

- **Uploads** go to `uploads/<client>/` with a presigned PUT (PNG, JPEG or WebP, 10 MB). The media Lambda re-encodes them with sharp (rotated, metadata and EXIF stripped, photos capped at 4000 px as JPEG, logos at 2000 px as PNG with transparency), sets a focal point from Rekognition `DetectFaces` (centre of the faces, or the middle), and stores them privately under `assets/<client>/`. The browser sees them through 1-hour presigned URLs. SVG is not accepted yet.
- **Brand kits** per client: colors by role, light and dark logos, approved photos, services, offers and CTAs.
- **Ad sets (projects)** pin a published template version. A new ad set takes colors, logo, photo, CTA and offer from the brand kit; every other text slot starts as `[confirm]`, so nothing is invented. Clients only see published templates the agency enabled for them (all by default, or a list on the client's Account tab).
- **Editor**: edit each slot once for all sizes, shorter text per size where needed, character counters per size, photo focal point by clicking, colors by role. All 8 sizes render live; overflow, missing values, `[confirm]` and 9:16 safe-zone problems are listed and block export.
- **Export**: the API checks permissions and the content again, writes a snapshot, and starts a Step Functions run. A Map (concurrency 8) calls the **render Lambda** for each size: an x86_64 container with headless Chromium (`@sparticuz/chromium`, pinned) that loads `render.html`, a page built from the same React/Konva renderer, text fitter and font files as the editor. The page re-checks fit and placeholders, then sharp compresses: display sizes as JPEG with a binary search from quality 90 down to 60 until 150 KB or less (PNG-8 if that fails, otherwise the export fails with a clear reason); Meta sizes as JPEG quality 90. A zip step writes the ZIP plus `manifest.json`; failures mark the export `failed` with the reason.
- **Archive**: ad sets per client with duplicate, and every export with re-download through a 5-minute presigned URL.

| Entity | PK | SK | GSI1PK / GSI1SK |
| --- | --- | --- | --- |
| Asset | `CLIENT#<id>` | `ASSET#<assetId>` | |
| Brand kit | `CLIENT#<id>` | `BRAND#<kitId>` | |
| Project | `PROJ#<id>` | `META` | `CLIENT#<id>#PROJECTS` / `<createdAt>` |
| Export | `PROJ#<id>` | `EXPORT#<ts>#<exportId>` | |

S3 layout in the assets bucket: `uploads/` (raw, deleted after processing, expires after 1 day), `assets/<client>/` (processed), `exports/<client>/<project>/<export>/` (snapshot, files, ZIP; moved to Infrequent Access after 90 days).

## Payments (phase 4)

- **Prices** per task type (`template-set`, `re-export`, and `ai-set`, `single-size`, `image-edit` for later phases), set by anyone with `pricing:manage`, with optional per-client overrides. Prices are passed to Checkout as `price_data`, so changing one never needs the Stripe dashboard. The amount is always looked up on the server.
- **Export with payment.** If the client has "Payment required" on, the first export of an ad set is charged as `template-set` and later ones as `re-export`. The API writes the snapshot, creates a Checkout Session (idempotency key per export, `client_reference_id` and metadata with the export, project and client) and returns its URL; the export waits as `awaiting_payment`. Exempt clients start rendering straight away and a $0 `exempt` transaction is recorded.
- **Webhook** (`POST /webhooks/stripe`, its own Lambda): verifies the Stripe signature (5-minute tolerance), skips events it has already processed (`STRIPE#<eventId>`, kept 30 days), and handles `checkout.session.completed` / `async_payment_succeeded` (records the transaction with the receipt URL, then starts the render) and `charge.refunded` (marks the transaction refunded and revokes the export's downloads).
- **Watermark.** Previews of an unpaid ad set for a paying client carry a light "PREVIEW" watermark. Final files only come from the server.
- **Download links.** "Email me the link" sends the signed-in user a branded SES email with `https://<app>/d/<token>`. The token is 32 random bytes, stored as a SHA-256 hash, expires after 7 days and opens one export. CloudFront sends `/d/*` to the API uncached, which checks the token, the export and refunds again, then redirects to a 5-minute presigned URL.
- **Transactions**: admins filter by date, client and status and download CSV (cells that would start a spreadsheet formula are escaped); client owners see their own on the Payments tab. Each row links to the receipt and the Stripe payment.

| Entity | PK | SK | GSI1PK / GSI1SK |
| --- | --- | --- | --- |
| Price (default) | `ORG` | `PRICE#<taskType>` | |
| Price override | `CLIENT#<id>` | `PRICE#<taskType>` | |
| Transaction | `CLIENT#<id>` | `TXN#<ts>#<exportId>` | `TXNS` / `<ts>#<exportId>` |
| Download token | `DL#<sha256>` | `META` (TTL 7 days) | |
| Stripe event | `STRIPE#<eventId>` | `META` (TTL 30 days) | |

**Stripe setup** (test mode first):

```bash
npm run claude:key        # only when CLAUDE_PROVIDER=anthropic: stores the Anthropic API key
npm run stripe:keys       # stores the secret key (sk_test_...) in SSM; leave the webhook secret blank
npm run stripe:webhook    # registers the deployed webhook URL in Stripe and stores its signing secret
```

Then set prices under Pricing and switch "Payment required" on for a client. Set `SENDER_EMAIL` in `infra/.env` and redeploy to enable emailed links; SES sends that address a verification email, and while the account is in the SES sandbox the recipients must be verified too.

## Website scan (phase 5)

A client pastes their website address, confirms they own or represent it (the statement, user and time are stored on the scan and in the audit log), and gets a draft brand kit to review. Nothing is saved until they press Save.

1. **Validate** (API): http(s) only on ports 80/443, and every address the host resolves to must be public. One running scan per client and 10 a day.
2. **Browse** (Lambda + **AgentCore Browser**): an AWS-managed, isolated Chromium session, connected with Puppeteer over a SigV4-signed WebSocket, so client sites never run inside our Lambdas or VPC. It opens the home page and up to 5 more pages from the same site (services, products, offers or pricing, about, contact) and runs one capture script on each: title, meta and Open Graph tags, JSON-LD, logo candidates (header images linking home, anything named logo or brand, inline SVG, CSS background logos, app icons, `og:logo`), computed colours of buttons, links, headers, headings and backgrounds plus `:root` colour variables, fonts, main text, headings, CTA labels, images of 400 px or more, and navigation links. A screenshot of each page goes to S3.
3. **Process** (media container): logo candidates are ranked by rules (header, link home, "logo" in the name, repeated across pages; award, partner, payment and social badges penalised), downloaded through the **guarded fetcher**, SVGs sanitised (no scripts, event handlers, external references, entities or foreignObject) and rasterised. Photos are downloaded (up to 40), de-duplicated by perceptual hash, resized, and given a focal point from Rekognition faces. The palette combines CSS colours weighted by role with a k-means over the screenshots, drops near-white and near-black, and fixes text contrast.
4. **Analyse** (Claude Haiku 5.5 on Bedrock, structured outputs, no tools): picks the real logo from previews shown on light and dark backgrounds, labels and rates every photo, and extracts business name, services, value propositions, offers, CTAs, tone and audience. Page text goes in as quoted data with an instruction to ignore anything that looks like an instruction. Every offer must quote the page; code then checks each quote against the captured text, drops offers whose quote is not there, moves an offer to the page that really has the quote, falls back to the quote when the model's wording adds numbers, and drops CTAs that are not on the site.
5. **Review** in the app: logo (Claude's pick preselected), colours by role, photos, services, offers with their quote and source link, CTAs. Saving copies the chosen logo and photos into the client's assets and creates the brand kit; the API only accepts offers that the scan found.

The **guarded fetcher** (all image downloads) allows http(s) on ports 80 and 443 only, resolves the host and pins the connection to an address it has checked, refuses private, loopback, link-local, CGNAT, metadata, multicast and documentation ranges (also IPv4-mapped, NAT64 and 6to4 IPv6, and decimal, hex and short IPv4 forms), re-checks every redirect hop (at most 3), and stops at 10 MB or 10 s. The body must sniff as PNG, JPEG, WebP, GIF, SVG or ICO.

| Entity | PK | SK |
| --- | --- | --- |
| Scan | `CLIENT#<id>` | `SCAN#<yyyymmddThhmmssZ>-<id>` |

Scan files (capture, screenshots, logo candidates, photos, result) live under `scans/<client>/<scan>/` in the assets bucket.

## AI generation and image helpers (phase 6)

**Claude provider** (`CLAUDE_PROVIDER` in `infra/.env`, one setting and a redeploy to change):

| Provider | Scan model | Copy model | Draft model | Notes |
| --- | --- | --- | --- | --- |
| `bedrock` (default) | Claude Haiku 5.5 | Claude Sonnet 5.5 | Claude Haiku 5.5 | Bedrock Mantle endpoint; the account needs access to these models |
| `bedrock-legacy` | Claude Haiku 4.5 | Claude Sonnet 4.6 | Claude Haiku 4.5 | Bedrock runtime (`InvokeModel`); used by this deployment while 5.x access is pending |
| `anthropic` | Claude Haiku 5.5 | Claude Sonnet 5.5 | Claude Haiku 5.5 | Claude API, key in SSM via `npm run claude:key` |

Prompts, structured outputs and validation are the same for all three. IAM allows `bedrock:InvokeModel` only on the named Claude and Stability models.

**Generate** (`POST /clients/:id/generations`, async; the generate Lambda does the work and the app polls):

1. **Pick templates:** published, enabled for the client, the right channel, required image slots fillable from the brand kit (no photo, no photo-led template), scored by tags matching the notes, whether there is an offer and how many colour roles the kit fills. Top 3.
2. **Write copy** with Claude Sonnet 5.5 (Claude Haiku 5.5 for quick drafts), one structured-output call per template: every text slot with the per-size character limits and line counts, facts only from the brand kit and the chosen offer, `[confirm]` where a fact is missing, and shorter wording for the sizes that need it.
3. **Images and colours:** the logo for light or dark backgrounds depending on what it sits on, photos matched to slots by aspect ratio (keeping their focal points), brand colours mapped to roles, and the text colour fixed when it would fail 4.5:1 (brand colours themselves are never changed).
4. **Validate:** the render Lambda checks every size with the real fonts (overflow, character limits), and code checks for unsourced claims: any number, currency or percent sign, or words such as free, best, guaranteed, sale or limited that are not in the brand kit or offer, and banned phrases. One retry with the problems listed; anything still failing becomes `[confirm]` (at that size for fit problems, everywhere for claims), so a variant never opens with overflowing text or an unsupported claim.

The client picks a variant and edits it like any ad set. Its first export is charged as `ai-set` when payment is required.

**Image helpers** (Stability AI on Bedrock, behind one `ImageService` adapter because the Bedrock image line-up changes): **Remove background** (logos and product photos), **Extend** a photo to 9:16, 4:5 or 1:1 (Outpaint, keeping the focal point), and **Generate background** (Style Guide with a swatch of the brand colours as the style reference; never people, faces, products, text or logos; falls back to a brand-colour gradient if the model is unavailable). Results are new assets marked AI edited or AI generated, with the source asset recorded. Limits: 20 generations and 20 image edits a day per client.

| Entity | PK | SK |
| --- | --- | --- |
| Generation | `CLIENT#<id>` | `GEN#<id>` |

## Roles and scopes

| Role | Type | Grants |
| --- | --- | --- |
| Super Admin | staff | everything, `all` |
| Admin | staff | clients, staff assignment, client-user invites, projects, brand kits, templates, `all`. No users, roles, settings or pricing |
| Account Manager | staff | templates `all`; clients, client-user invites, projects, brand kits `assigned` |
| Client Owner | client | own client, projects, brand kits, transactions, invite client users, `own` |
| Client User | client | own client and projects, read brand kits, `own` (no payments, brand kit edits, scans or AI image edits) |

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

Prerequisites: an AWS account in `us-east-1` with CDK bootstrapped and Bedrock access to Claude Haiku 5.5 (`anthropic.claude-haiku-5-5`), Node.js 24, and Docker (the render Lambda is a container image). The local render and golden tests use your installed Google Chrome (`CHROME_PATH` to point elsewhere).

```bash
npm run install:all
cp infra/.env.example infra/.env          # optional: APP_NAME used before branding is set
npm run infra:deploy                      # builds the client and deploys; writes infra/cdk-outputs.json
npm run bootstrap -- you@example.com      # seeds the 5 roles and invites you as Super Admin
npm run seed:templates                    # 3 sample templates as drafts; open, lint and publish them
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
| `GET` / `POST` | `/templates` | `template:read` / `template:create` |
| `GET` / `PUT` | `/templates/:id` | `template:read` / `template:create`; save needs the current `revision` |
| `POST` | `/templates/:id/publish` | `template:publish`; lint report + server lint, then a new version |
| `GET` | `/templates/:id/versions`, `/templates/:id/versions/:n` | `template:read` |
| `POST` | `/templates/:id/asset-upload-url` | `template:create`; sample image, up to 5 MB |
| `GET` | `/clients/:id/assets` | `client:read`; ready assets with preview URLs |
| `POST` | `/clients/:id/assets/upload-url`, `/clients/:id/assets/:assetId/complete` | `brandkit:edit`; presigned upload, then processing |
| `PUT` | `/clients/:id/assets/:assetId` | `brandkit:edit`; name and focal point |
| `GET` / `POST` / `PUT` | `/clients/:id/brand-kits`, `/clients/:id/brand-kits/:kitId` | `client:read` / `brandkit:edit` |
| `GET` | `/clients/:id/templates`, `/clients/:id/templates/:templateId` | `project:create`; published and enabled only |
| `GET` / `POST` | `/clients/:id/projects` | filtered by `project:read` / `project:create` |
| `GET` / `PUT` | `/projects/:id` | `project:read` / `project:edit`; save needs the current `revision` |
| `POST` | `/projects/:id/duplicate` | `project:read` + `project:create` |
| `POST` | `/projects/:id/export` | `project:export`; returns `{ exportId }` |
| `GET` | `/projects/:id/exports`, `/projects/:id/exports/:exportId` | `project:read` / `project:download` (download URL) |
| `POST` | `/projects/:id/exports/:exportId/email` | `project:download`; emails the signed-in user a 7-day link |
| `GET` / `PUT` / `DELETE` | `/prices`, `/prices/:taskType` | `pricing:manage` |
| `GET` / `PUT` / `DELETE` | `/clients/:id/prices`, `/clients/:id/prices/:taskType` | `pricing:manage` |
| `GET` | `/clients/:id/transactions` | `txn:read` on the client |
| `GET` | `/transactions?from&to&clientId&status&format=csv` | `txn:read` |
| `GET` | `/d/:token` | public; checks the token, then redirects to the file |
| `POST` | `/webhooks/stripe` | public; Stripe signature required |
| `POST` | `/clients/:id/scans` | `brandkit:edit`; `{ url, confirmOwnership: true }` |
| `GET` | `/clients/:id/scans`, `/clients/:id/scans/:scanId` | `client:read`; result with preview URLs when ready |
| `POST` | `/clients/:id/scans/:scanId/brand-kit` | `brandkit:edit`; saves the reviewed draft |
| `POST` | `/clients/:id/generations` | `project:create`; `{ brandKitId, channel, serviceName?, offerText?, notes?, quality }` |
| `GET` | `/clients/:id/generations/:generationId` | `client:read`; status and the 3 variants |
| `POST` | `/clients/:id/generations/:generationId/variants/:index/project` | `project:create`; opens a variant as an ad set |
| `POST` | `/clients/:id/images/:assetId/remove-bg`, `/clients/:id/images/:assetId/outpaint` | `brandkit:edit`; outpaint takes `{ aspect }` |
| `POST` | `/clients/:id/images/background` | `brandkit:edit`; `{ brandKitId, style, aspect }` |

## Tests

```bash
npm run typecheck
npm run backend:test     # offline: keys and schemas, Cedar policy matrix, template model, media
npm --prefix backend run test:render       # render page in your local Chrome: 3 templates x 8 sizes
npm --prefix backend run test:scan-local   # browses the 10 fixture sites in your local Chrome; rules-only logo and palette
npm run infra:test       # synthesizes the stack and asserts on the template
npm run test:live        # against the deployed stack (needs bootstrap first)
```

- **Policy matrix:** every role x action x resource (own, assigned, other client, org, template) is evaluated with the real Cedar engine against the strict schema, and compared with an independent reading of the role grants. `test:live` runs the same matrix against the deployed policy store.
- **Flow (live):** a Super Admin creates two clients, invites a staff user and a client user, assigns the staff user to client A; the staff user sees A only and gets 404 on B; the client user sees only their client and can't edit it, list users or read settings. Test users and clients are removed afterwards.
- **Template model:** wrapping (spaces, long words, CJK, newlines), shrink and clamp fitting, cover crop at all 8 aspect ratios, contrast maths, seed templates valid and lint-clean, bad bindings, missing sizes, unknown color roles, duplicate ids and external image URLs refused, safe-zone and missing-slot errors, adapt-to-sizes.
- **Templates (live):** create, invalid draft refused, stale revision conflict, browser lint errors and server-side safe-zone errors block publishing, v1 is immutable after later edits, an unchanged draft can't be published twice, an Account Manager can read but not create or publish, upload URLs are scoped and size-limited.
- **Media (offline):** flat ads keep quality 90, busy ones are squeezed under 150 KB, an impossible display file is refused with a reason, Meta sizes are JPEG 90, EXIF is stripped, photos are capped at 4000 px, logos keep transparency, SVG, GIF and text files are rejected.
- **Render (local Chrome):** every seed template at every size renders at the exact pixel size with no fit errors and compresses under the cap; `[confirm]` and overflowing copy are reported by the render page.
- **Projects (live):** upload and processing (EXIF gone), a fake image rejected, cross-client upload refused, brand kit fills the new ad set, `[confirm]` blocks export, cross-client assets refused, export of 8 files with every display file at most 150 KB and exact dimensions in the ZIP, cross-client download refused, an export with copy that does not fit fails with the reason, duplicate and archive.
- **Golden (live):** 3 templates x 2 content sets x 8 sizes rendered by the deployed render Lambda and by local Chrome; each pair must differ in under 0.5% of pixels. Diff images go to `.playwright-mcp/golden-diffs/` when one fails.
- **Payments (offline):** signed webhooks verify; tampered bodies, other secrets and hour-old signatures are rejected; CSV amounts, labels and formula escaping; price validation; token format and hashing.
- **Payments (live):** an exempt client exports without Checkout and gets a $0 transaction; a paying client gets a Checkout URL and an `awaiting_payment` export with the server-side amount and no download; a bad signature is rejected; a signed `checkout.session.completed` (sent twice) records one paid transaction and renders the export; the emailed link redirects to the file; a signed `charge.refunded` revokes the link and the in-app download and marks the transaction refunded; client users cannot see payments. The paid part needs the Stripe keys and is skipped with a note otherwise.
- **Fetcher (offline):** 16 private and special address forms refused, public ones allowed; file scheme, metadata IP, loopback, decimal, hex and short IP forms, localhost after DNS, credentials and odd ports refused; HTML served as `image/png` refused; a redirect to the metadata IP refused on the hop; a fourth redirect, an oversized body, a slow response and a 404 refused; SVG, JPEG sniffing.
- **Scan (offline):** offer quotes checked against page text (kept, dropped, moved to the right page, invented numbers removed), unknown CTAs dropped; SVG scripts, handlers, external references, entities and foreignObject removed; palette roles, contrast fix and an empty site; k-means; same-site page choice skipping login and privacy pages.
- **Scan (local Chrome):** 10 generated fixture sites (`backend/test/fixtures/sites.ts`) with a header image logo, an inline SVG, an `og:logo`, a CSS background logo, a text-only logo with an app icon, an SVG file, footer award badges, a white logo on a dark header and an unlabelled inline SVG; offers on some, none on others. Checks the pages visited, the logo shortlist, the palette and that every real offer is captured.
- **Scan eval (live):** the same 10 sites uploaded under `scan-fixtures/` and scanned through the deployed pipeline (AgentCore Browser, media container, Claude Haiku 5.5). Exit check: correct logo for at least 8, usable palette for all 10, no offer whose quote is not on the site; also a reviewed draft saves as a brand kit, an invented offer cannot be saved, client users cannot scan, private addresses and missing ownership confirmation are refused.
- **Generation (offline):** unsourced numbers, currency, percentages, free, superlatives and banned phrases flagged and offer-backed ones allowed; copy applied with valid per-size overrides; fit and claim problems mapped to slots and turned into `[confirm]`; template choice by channel, fillable slots and offer; the text colour fixed without touching brand colours; the dark-background logo chosen on a dark header; outpaint geometry and caps.
- **Generation (live, exit check):** a fixture website is scanned and saved as a brand kit, 3 variants are generated, and each is opened as an ad set and re-checked independently: no overflow at any size with the real fonts, no unsourced claim at any size. Also remove background, extend to 9:16, generate background, client users cannot use AI image edits, and offers outside the brand kit are refused.
- **Infra:** invite-only pool, SRP only for the web client, 15-minute access tokens, strict policy store, only `/health` and `/branding` public, private encrypted buckets, Node 24 arm64, no VPC or NAT.

## Build log

| Phase | What |
| --- | --- |
| 1 | Foundation and auth: table, buckets, Cognito invites, Verified Permissions with 5 roles, API skeleton, branded shell |
| 2 | Templates and renderer: shared template model, Konva renderer, admin builder, browser + server lint, publish and versioning, 3 seed templates |
| 3 | Client editor and export: uploads with sharp and Rekognition, brand kits, 8-size editor, Chromium render Lambda, compression, ZIP, archive, golden tests |
| 4 | Payments: price catalogue and overrides, Stripe Checkout, signed and de-duplicated webhooks, transactions and CSV, refunds that revoke downloads, preview watermark, emailed download links |
| 5 | Website scan: AgentCore Browser capture, guarded fetcher, logo ranking and SVG sanitising, palette, photo de-duplication and focal points, Claude Haiku 5.5 logo pick, photo labels and quoted-offer extraction, review and save as brand kit |
| 6 | AI generation and image helpers: Claude provider switch (Bedrock or API key), template picking, Claude Sonnet 5.5 copy within per-size limits, real-font fit check and unsourced-claim check with one retry, remove background, outpaint, brand-colour backgrounds |

## Tear down

```bash
npm run teardown    # cdk destroy, then deletes the Stripe keys in SSM, leftover log groups and local outputs
```

Everything the stack creates (table, buckets, user pool, policy store, logs) is removed with it.
