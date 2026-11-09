# 0002: Server rendering in headless Chromium

**Status:** accepted

**Context.** Exports must match the browser preview. `node-canvas` uses different font shaping and anti-aliasing from browsers.

**Decision.** A container Lambda (x86_64, 3 GB) runs pinned headless Chromium (`@sparticuz/chromium`) and loads `render.html`, a page built from the same client code and font files as the editor. It returns a PNG plus the fitted layout; sharp then compresses. The same page has a check mode the AI generation step uses to measure text with real fonts.

**Consequences.** One rendering path. Cold starts are a few seconds and the image is about 900 MB. The golden test compares the deployed renderer with a local browser: font sizes and line breaks must match exactly, and pixels within 3% (glyph edges differ between operating systems).
