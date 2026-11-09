# 0003: Amazon Verified Permissions with roles as data

**Status:** accepted

**Context.** The agency needs to add roles without a deploy, and staff must only see assigned clients.

**Decision.** Cedar policies in Verified Permissions, checked on every request. A role is a DynamoDB item with grants (actions plus scope: all, assigned, own); saving it generates one static Cedar policy per grant. AVP policy templates were not used because their slots cannot vary the action list. User entities (roles, assigned clients, own client) are loaded from DynamoDB and cached for 60 seconds per Lambda instance.

**Consequences.** Authorization decisions are auditable and testable: the policy matrix test runs every role, action and resource through the Cedar engine offline and against the deployed store. Permission changes take up to a minute to reach every instance.
