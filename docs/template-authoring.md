# Template authoring guide

For the agency's designers. Templates are built in Templates in the admin area; this guide explains the rules lint checks before publishing.

## Sizes

| Channel | Sizes | Rules |
| --- | --- | --- |
| Display | 300x250, 728x90, 300x600, 336x280, 320x50 | Exported as JPG or PNG at 150 KB or less |
| Meta | 1080x1080, 1080x1350, 1080x1920 | Full resolution; 1080x1920 keeps text, buttons and the logo inside the safe zone |

A template for "Display and Meta" has all 8 artboards. Build one carefully, then use **Adapt to all sizes** and tidy each size; the copy is proportional, not a final layout.

## Slots, not elements

Clients and AI change **slots**: text slots (headline, subhead, offer, cta, or your own) and image slots (logo, photo, or your own). Bind each element to a slot in the properties panel; elements without a slot keep their fixed text.

- Mark a slot **required** when every size must show it; lint fails if a required slot is not placed at some size.
- Give every text slot a **maximum number of lines** and a **maximum number of characters per size**. Lint tests each size with copy at that length, and AI-written copy is kept within it.
- Set a **minimum font size** on each text element. Text shrinks from the designed size down to the minimum, then the element is reported as overflowing. Keep display minimums at 10 px or more.

## Colours

Bind fills and text colours to **colour roles** (primary, secondary, accent, text, background) instead of fixed colours wherever the client's brand should show. Fixed colours suit overlays and neutral details. Lint warns when text and its background fall below 4.5:1 contrast with the sample colours; the AI generator also corrects the text colour when a brand palette would make it unreadable.

## Images

- Image elements **cover** their frame around the photo's focal point by default (clients can move the focal point), or **contain** (logos).
- Put the logo on a plain area. Generation chooses the client's light or dark logo based on what sits under it.
- Photo-heavy layouts at 300x600 and 336x280 struggle to fit in 150 KB; lint renders each display size at JPEG quality 60 and fails the template if it is still too large. Flatter layouts, smaller photo areas or overlays help.

## Safe zone (1080x1920)

The red overlay shows the Meta 9:16 no-go areas (default: top 14%, bottom 35%, 6% each side; changeable in Settings). Text, buttons and the logo must sit fully inside the safe area; photos and background shapes may run underneath.

## Locks

Locks describe what clients may change on an element: **fully locked** (nothing), or individual properties (text, fill, image, visibility). Designers can always move and edit everything in the builder.

## Publishing

Save, run **Lint**, fix errors (warnings are allowed), then **Publish**. Each publish creates an immutable version; existing ad sets keep their version, so editing a template never changes ads already made. Choose which clients see a template on each client's Account tab.
