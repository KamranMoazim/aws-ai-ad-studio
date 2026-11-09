# 0001: Konva for the editor and renderer

**Status:** accepted

**Context.** The client editor shows 8 sizes live, the admin builder needs drag, resize and rotate, and exports must look exactly like the preview. Candidates were Konva (`react-konva`) and Fabric.js.

**Decision.** Use Konva through `react-konva`. One `AdStage` component renders a template layout for a size in the editor, the builder, the template picker and the server render page.

**Consequences.** Konva fits React state well and handles many small stages. Fabric's strength, free-form drawing, is exactly what clients must not do. Text layout is done by our own fitter (`shared/src/fit.ts`) and drawn with wrapping off, so line breaks never depend on the canvas library.
