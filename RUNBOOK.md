# AdStudio runbook

Day-to-day operations. Commands run from the repository root with AWS credentials for the agency's account (`us-east-1`).

## Alarms

Alarms publish to the `AlertTopicArn` SNS topic; set `ALERT_EMAIL` in `infra/.env` and confirm the subscription email to receive them.

| Alarm | Meaning | What to do |
| --- | --- | --- |
| `<Function>Errors` | A Lambda threw | Open the function's log group (`/aws/lambda/AdStudioStack-...`, kept 14 days) and search for `failed` |
| `ApiThrottles`, `RenderThrottles` | Lambda ran out of concurrency | See [Lambda concurrency](#lambda-concurrency) |
| `ExportFailed` | An export state machine run failed | The export is marked `failed` with a reason the client sees; open the execution in Step Functions for the cause |
| `ScanFailed` | A website scan failed | Usually a site that blocks automated browsers; the client can build the brand kit by hand |
| `Api5xx` | The API returned 5xx | Check the `Api` log group |
| `DeadLetters` | AI generations failed outside the handler (timeouts, crashes) | Fix the cause, then [redrive](#dead-letter-redrive) |

The `adstudio-monthly` budget emails at 80% of $50 actual spend and at 100% forecast.

## Dead-letter redrive

```bash
npm run dlq:redrive -- --dry-run   # list what would be retried
npm run dlq:redrive                # reset each generation to queued and run it again
```

## Lambda concurrency

New AWS accounts start with a limit of 10 concurrent Lambda executions; this account is one of them. Exports render 4 sizes at a time (`RENDER_CONCURRENCY` in `infra/.env`) so the API stays responsive. Request an increase to the default 1,000 in Service Quotas (AWS Lambda, "Concurrent executions", us-east-1; free), then set `RENDER_CONCURRENCY=8` and redeploy.

## Rotating keys

| Key | Command | Notes |
| --- | --- | --- |
| Stripe secret key | `npm run stripe:keys` | Lambdas cache keys; redeploy (`npm run infra:deploy`) or wait for new instances |
| Stripe webhook secret | `npm run stripe:webhook` | Re-registers the endpoint and stores the new signing secret |
| Anthropic API key | `npm run claude:key` | Only used when `CLAUDE_PROVIDER=anthropic` |

## Switching where Claude runs

Set `CLAUDE_PROVIDER` in `infra/.env` and run `npm run infra:deploy`:

- `bedrock`: Claude Haiku 5.5 and Sonnet 5.5 on Bedrock (needs model access; check with `aws bedrock get-foundation-model-availability --model-id anthropic.claude-haiku-5-5`, `agreementAvailability` must be `AVAILABLE`).
- `bedrock-legacy`: Claude Haiku 4.5 and Sonnet 4.6 on Bedrock (current setting).
- `anthropic`: the Claude API with the key from `npm run claude:key`.

To change the models themselves, set `CLAUDE_FAST_MODEL` (website scans, drafts) and `CLAUDE_COPY_MODEL` (final ad copy) in `infra/.env` and run `npm run infra:deploy`; the deploy grants access to exactly those models. On Bedrock use an inference profile id such as `us.anthropic.claude-sonnet-4-6`. Models must support structured outputs (Claude 4.5 or newer).

## Users, roles and MFA

- **Invite** users under Users (staff) or a client's Account tab (client users). Cognito emails a temporary password valid for 7 days; resend by disabling and re-inviting, or by `aws cognito-idp admin-create-user --message-action RESEND`.
- **Add a role** under Roles: choose staff or client, tick permissions, choose whether a staff role covers all clients or assigned ones, save. The role's Cedar policies are rewritten; users pick it up within a minute. Starting roles can be edited but not deleted; a role still held by users cannot be deleted.
- **Reset the starting roles** to their defaults: `npm run bootstrap -- <super admin email> --reset-roles`.
- **Staff MFA**: staff set up an authenticator app at their next sign-in. If someone loses their device, clear their MFA with `aws cognito-idp admin-set-user-mfa-preference --user-pool-id <UserPoolId> --username <email> --software-token-mfa-settings Enabled=false,PreferredMfa=false` and set `mfaEnabled` to false on their `USER#<sub>` item; they will be asked to set it up again. Super Admins can turn the requirement off in Settings.

## Templates

- Build in Templates, run **Lint** (all sizes, real fonts, 150 KB check), **Publish**. Published versions never change; ad sets keep the version they started with.
- Choose which templates each client sees on the client's Account tab.
- Authoring rules: [docs/template-authoring.md](docs/template-authoring.md).
- Reset the 3 sample templates: `npm run seed:templates -- --reset`.

## Payments

- Prices under Pricing (per task type), overrides on a client's Account tab, "Payment required" per client.
- Refund in the Stripe dashboard; the `charge.refunded` webhook marks the transaction refunded and disables that export's downloads and emailed links.
- Test locally with `stripe trigger checkout.session.completed` against the deployed webhook only after `npm run stripe:webhook`.

## Website scans

- Failures are shown to the client with a plain reason. Sites behind bot protection often fail; the brand kit can be built by hand.
- Scan files expire after 30 days; saved brand kit images are copied into the client's assets first.

## Deploy, demo data and teardown

```bash
npm run install:all
npm run infra:deploy                         # builds the client and the container image, deploys
npm run bootstrap -- you@example.com         # roles and the first Super Admin
npm run seed:demo                            # publishes the sample templates, demo client and brand kit
npm run openapi                              # regenerates docs/openapi.json
npm run teardown                             # removes the stack, keys in SSM and leftover log groups
```

If `cdk deploy` appears to hang after CloudFormation reports `UPDATE_COMPLETE` (seen on unreliable connections), the deployment has finished; stop it and run `npm run client:config` if the outputs file needs refreshing.
