# AdStudio user guide

How to use AdStudio day to day: get an account, brand the app, set up clients and templates, make ads from a template or a website, export and pay, and look after users and costs. For how it is built, see the [README](README.md), [ARCHITECTURE.md](ARCHITECTURE.md) and the [architecture diagram](docs/architecture.drawio) ([PNG](docs/architecture.png)). For operations (alarms, keys, redrive), see the [RUNBOOK](RUNBOOK.md).

Every deployment has its own address. After `npm run infra:deploy`, read it from `infra/cdk-outputs.json`; this guide calls it `<SiteUrl>` (the `SiteUrl` output, a CloudFront address or your custom domain).

## Words used in the app

| Word        | Means                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Agency      | The company running this deployment. Its staff use the admin area                                                              |
| Client      | A business the agency makes ads for. Client users only ever see their own client                                               |
| Template    | A locked design made in the template builder: slots, colour roles and one layout per size. Only published versions can be used |
| Slot        | A part of a template that can be filled: headline, offer, CTA, photo, logo                                                     |
| Brand kit   | A client's colours, logos, photos, services, offers and calls to action                                                        |
| Ad set      | One ad in all 8 sizes, made from one published template version (called a project in the API)                                  |
| 8 sizes     | Display: 300x250, 728x90, 300x600, 336x280, 320x50. Meta: 1080x1080, 1080x1350, 1080x1920                                      |
| `[confirm]` | A placeholder for a fact nobody has given yet. It blocks export until someone replaces it                                      |
| Export      | The final files: JPEG or PNG per size (display sizes at most 150 KB), zipped with a manifest                                   |

## Who can do what

| Role            | Who          | Can                                                                                               |
| --------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| Super Admin     | Agency owner | Everything, including users, roles, settings and pricing                                          |
| Admin           | Agency staff | Clients, staff assignment, client-user invites, ad sets, brand kits and templates for all clients |
| Account Manager | Agency staff | Templates, plus clients, ad sets and brand kits for the clients assigned to them                  |
| Client Owner    | Client       | Their own ad sets, brand kits, website scans, AI tools, payments, and inviting their own users    |
| Client User     | Client       | Their own ad sets and exports; reads brand kits. No payments, scans or AI image edits             |

Roles are editable under **Roles**, and new ones can be added there without a deploy (see [Roles and permissions](#roles-and-permissions)).

## Getting an account

There is no self sign-up.

- **The first Super Admin** is created from the deployer's terminal: `npm run bootstrap -- you@example.com`. Cognito emails a temporary password.
- **Everyone else** is invited in the app: staff under **Users**, client users on a client's **Account** tab. They get an email with a temporary password valid for 7 days.

To sign in:

1. Open `<SiteUrl>`, enter the email and the temporary password, then choose a new password.
2. **Staff only:** set up two-step sign-in. Scan the QR code with an authenticator app (Google Authenticator, 1Password, Authy and similar) and enter the 6-digit code. From then on, every sign-in asks for a code. A Super Admin can turn this requirement off in **Settings**.
3. Forgot your password? Use **Forgot password?** on the sign-in page; a code arrives by email.

## First-time setup (agency)

1. **Branding** (Super Admin, **Settings**): app name, logo and colours. The sign-in page, the app and invite emails use them, so clients never see "AdStudio".
2. **Usage limits** (**Settings**): scans, AI generations and AI image edits per client per day. The defaults are 10, 20 and 20.
3. **Meta 9:16 safe zone** (**Settings**): the margins kept clear of text on 1080x1920 (defaults: top 14%, bottom 35%, sides 6%).
4. **Templates**: publish at least one. `npm run seed:demo` publishes 3 samples (Bold Offer, Photo Hero, Split Panel) and creates a "Demo Bakery" client to try things on.
5. **Pricing** (optional, Super Admin): a price per task type, and Stripe keys set up by the deployer (`npm run stripe:keys`, `npm run stripe:webhook`). Without them, keep clients exempt from payment.

## Templates (agency)

1. On **Templates**, choose **Create template**. Choose the channel (display, Meta or both).
2. **Build** on the canvas: add text, image, shape and button layers; drag, resize and rotate them; bind each to a slot; set fonts, colours (by brand role or a fixed colour), fit and crop; lock what clients must not move.
3. **Slots and colour roles:** name each slot, mark it required, and set character limits per size.
4. **Sample content:** add sample copy and images, with shorter text for small sizes where needed. **Adapt to all sizes** copies a layout to the other sizes as a starting point.
5. **Lint** checks all 8 sizes with the real fonts: missing slots, text in the 9:16 no-go area, low contrast (warning), overflow at the character limits, and display files over 150 KB.
6. **Publish** once lint has no errors. Published versions never change; ad sets keep the version they started with. To change a template, edit the draft and publish a new version.

Design rules for template authors: [docs/template-authoring.md](docs/template-authoring.md).

## Clients (agency)

1. On **Clients**, type the client's name and choose **Add client**.
2. On the client's **Account** tab:
   - **Assigned staff:** which Account Managers look after this client.
   - **Client users:** invite the client's people as Client Owner or Client User.
   - **Templates this client can use:** all published templates (the default) or a chosen list.
   - **Payment required** and **Price overrides**, if you charge this client.
3. Build the client's first **brand kit** yourself or let the client do it (next section).

## Brand kits

On a client's **Brand kits** tab, create a kit by hand or from the website.

**By hand:** colours by role (primary, secondary, accent, text, background), light and dark logos, approved photos, services, offers and calls to action. Upload logos and photos on the **Photos and logos** tab first: PNG, JPEG or WebP up to 10 MB. Files are re-encoded and their metadata removed, and photos get a focal point (faces when there are any) that keeps the important part in frame. Click a photo to move its focal point.

**From the website** (**Build a brand kit from a website**):

1. Paste the address and confirm you own or represent the site. The confirmation is recorded.
2. Wait about a minute while it reads up to 6 pages of the site.
3. Review the draft: the suggested logo, the colour palette, photos (with labels and quality ratings), services, offers and calls to action. Each offer shows the exact sentence it came from and a link to that page.
4. Untick anything you don't want and **Save**. Nothing is stored until you save. Offers that are not on the site are never added.

Sites behind bot protection may fail to scan; build the kit by hand instead.

## Making ads from a template

1. On the client's **Projects** tab, choose **Start from a template**, pick a template, name the ad set and choose a brand kit.
2. The editor opens with colours, logo, photo, CTA and offer filled from the brand kit. Every other text slot shows `[confirm]`.
3. Edit each slot once; all 8 sizes update live. Under each slot, the counters show length against the limit for every size. Use **Shorter text for some sizes** where a size needs fewer words.
4. Pick photos and logos per slot, or upload new ones. Click the photo preview to set the focal point.
5. **Check before export** lists what blocks export: text that doesn't fit, missing values, any `[confirm]` left, and text in the 9:16 safe zone. Fix them until the list is empty.
6. **Save**, then **Export 8 sizes**.

**Duplicate** on the Projects tab copies an ad set, for example to make a variant.

## Making ads with AI

1. On the **Projects** tab, choose **Make ads with AI**.
2. Choose the **Brand kit**, a **Focus** (one of the kit's services), an **Offer** from the kit (optional), the **Channel** (display, Meta or both), **Quality** (final, or a quick draft) and optional **Notes** such as "spring sale, friendly and urgent".
3. After about a minute, you get 3 variants, each on a different template, with copy written to fit every size and photos and colours from the kit.
4. Open the variant you like. It becomes an ad set you edit like any other. AI never invents prices, discounts or claims: anything it could not back up from the brand kit appears as `[confirm]` for you to check.

**AI image helpers** (Client Owners and staff, on the **Photos and logos** tab): **Remove background** (logos, product shots), **Extend** a photo to 9:16, 4:5 or 1:1, and **Generate a background** in the brand colours (abstract only, never people, products or text). Each makes a new file marked AI edited or AI generated and keeps the original.

## Exporting, paying and downloading

1. **Export 8 sizes** in the editor. If the client is exempt from payment, rendering starts at once. Otherwise the app opens Stripe Checkout with the price for this ad set, and rendering starts after payment.
2. Unpaid previews for paying clients carry a light "PREVIEW" watermark. The exported files never do.
3. When the export is ready (usually under a minute), use **Download ZIP**, or **Email me the link** for a link valid for 7 days.
4. Every export stays in the ad set's export list for downloading again. If a payment is refunded in Stripe, that export's downloads and emailed links stop working.

The ZIP holds one file per size plus `manifest.json`. Display sizes are JPEG (or PNG) at 150 KB or less; Meta sizes are high-quality JPEG.

Client Owners see their payments and receipts on the **Payments** tab. The agency sees all of them under **Transactions**, where it can filter by date, client and status and download a CSV.

## Roles and permissions

Under **Roles** (Super Admin):

- **Edit a role:** tick its permissions and choose the scope. Staff roles cover all clients or only assigned clients. Client roles always cover only their own client.
- **New role:** name, staff or client, permissions, scope. Users get changes within a minute; no deploy is needed.
- **Delete** works for custom roles that no user holds. The 5 starting roles can be edited but not deleted. `npm run bootstrap -- <email> --reset-roles` restores their defaults.

## Users and the audit log

- **Users** (Super Admin): invite staff, change roles, and disable or re-enable anyone. A disabled user cannot sign in, and the app refuses their requests within a minute.
- **Audit** (Super Admin): every change by month, with who made it and when. It includes website ownership confirmations.

## Costs and limits

AdStudio is serverless: an idle deployment costs about $1 a month, plus $10-18 for AWS WAF if it is on. The paid steps are the AI ones:

| Action                     | Roughly     |
| -------------------------- | ----------- |
| Website scan               | $0.01-0.04  |
| AI generation (3 variants) | $0.05-0.15  |
| AI image edit              | $0.06-0.08  |
| Export of 8 sizes          | under $0.01 |

Daily per-client limits in **Settings** cap AI spend, and a $50 monthly budget alert emails the address in `ALERT_EMAIL`. Prices change; check the AWS pricing pages before relying on these numbers.

## Troubleshooting

| You see                                         | Do this                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| "Set up two-step sign-in to continue"           | You are staff: sign out and back in, then scan the QR code. A Super Admin can turn the requirement off in Settings |
| Grey "photo" or "logo" boxes in the editor      | Reload the page (Cmd+Shift+R). Preview links last an hour                                                          |
| Export button disabled                          | Open **Check before export** and fix each item listed                                                              |
| "Up to N ... a day per client"                  | The daily limit is used up. Wait until tomorrow, or a Super Admin raises it in Settings                            |
| Website scan failed                             | The site may block automated browsers. Build the brand kit by hand                                                 |
| An AI image helper says "try again in a moment" | The image model was busy or is not enabled in Bedrock; see the RUNBOOK                                             |
| Invite email never arrived                      | Check spam. Cognito's default sender allows 50 emails a day; ask an admin to invite again                          |

## Removing everything

`npm run teardown` deletes the stack, every bucket and table, the stored keys and the leftover logs. Download any exports you want to keep first; this cannot be undone.
