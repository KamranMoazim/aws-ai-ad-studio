# 0004: One DynamoDB table

**Status:** accepted

**Context.** Access patterns are known (README, single-table section), traffic is small and bursty, and idle cost should be near zero.

**Decision.** One on-demand table with `PK`/`SK`, one GSI and a TTL attribute. Large documents (template bodies, export snapshots, scan results) live in S3 with a key in the item.

**Consequences.** No idle cost and one backup scope. Every new feature adds key patterns rather than tables; keys are built only in `backend/src/core/keys.ts` and covered by tests.
