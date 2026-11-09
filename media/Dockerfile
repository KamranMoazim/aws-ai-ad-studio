# syntax=docker/dockerfile:1
FROM public.ecr.aws/lambda/nodejs:24 AS build
WORKDIR /src
RUN --mount=type=cache,target=/root/.npm npm install -g esbuild@0.28.2 --fetch-retries=6 --fetch-timeout=600000
COPY shared/package.json shared/package.json
COPY shared/src shared/src
COPY backend/package.json backend/package.json
COPY backend/src backend/src
RUN esbuild backend/src/media/render.ts backend/src/media/process-upload.ts \
  --bundle --platform=node --format=esm --target=node24 --outdir=/out --out-extension:.js=.mjs \
  --external:sharp --external:puppeteer-core --external:@sparticuz/chromium --external:@aws-sdk/* \
  "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

FROM public.ecr.aws/lambda/nodejs:24
COPY media/package.json media/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --fetch-retries=6 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=300000 --fetch-timeout=900000
COPY --from=build /out/ ./
COPY client/dist ./render-page
CMD ["render.handler"]
