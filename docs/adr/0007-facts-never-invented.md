# 0007: Facts are never invented

**Status:** accepted

**Context.** Ads make claims that clients are responsible for. Models are good at copy and poor at knowing which prices and promises are real.

**Decision.** Offers come only from the website (with a quote that code checks against the captured page text) or from the client. Generated copy is checked in code: numbers, currency and percent signs, and claim words (free, best, guaranteed, sale and similar) must appear in the brand kit or the chosen offer. One retry with the problems listed; anything still failing becomes `[confirm]`, which blocks export until a person fills it in.

**Consequences.** Some generated slots arrive as `[confirm]`. That is the intended trade: a person fills in a fact rather than the system shipping one it cannot support.
