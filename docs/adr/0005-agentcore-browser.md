# 0005: AgentCore Browser for website scans

**Status:** accepted

**Context.** Scanning means loading arbitrary third-party sites, many of which need JavaScript. Running them inside our Lambdas would expose the Lambda runtime and any internal endpoints to untrusted pages.

**Decision.** Pages are loaded in AWS-managed AgentCore Browser sessions, controlled with Puppeteer over a SigV4-signed WebSocket. Our Lambdas only receive the captured data. Images are then downloaded by our guarded fetcher, which only connects to public addresses.

**Consequences.** Small per-scan cost for browser time; untrusted pages never run in our account's compute. Sites behind bot protection can still fail, so the brand kit can always be built by hand.
