# 0006: Claude provider switch

**Status:** accepted

**Context.** The plan was Claude Haiku 5.5 and Sonnet 5.5 on Amazon Bedrock so that all spend stays on the agency's AWS bill. The account's Bedrock agreement for Claude 5.x is not available ("contact AWS Sales"), while Claude Haiku 4.5 and Sonnet 4.6 work through the Bedrock runtime API.

**Decision.** One module (`backend/src/core/claude.ts`) creates the client and picks the model per job (scan, copy, draft) from `CLAUDE_PROVIDER`: `bedrock` (Mantle endpoint, Claude 5.x), `bedrock-legacy` (InvokeModel, Claude 4.x) or `anthropic` (Claude API with a key in SSM). All calls use the official Anthropic SDK and structured outputs, so prompts and validation are identical.

**Consequences.** The deployment runs on `bedrock-legacy` today and moves to `bedrock` with one setting once access is granted. Effort is only sent to models that accept it.
