import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { loadOutputs } from './outputs.js';

const outputs = loadOutputs();
const { DEFAULT_SAFE_ZONE, hasErrors, lintTemplate, SEED_TEMPLATES } = await import(
  '../../shared/src/index.js'
);
const { createTemplate, getTemplateMeta, publishVersion } = await import(
  '../src/data/templates.js'
);
const { createClient, listAllClients } = await import('../src/data/clients.js');
const { saveAsset } = await import('../src/data/assets.js');
const { listBrandKits, saveBrandKit } = await import('../src/data/brand-kits.js');
const { newId } = await import('../src/core/ids.js');
const { uploadKey } = await import('../src/core/keys.js');

const DEMO_CLIENT = 'Demo Bakery';
const SEED_USER = 'seed-script';
const s3Client = new S3Client({ region: outputs.Region });
const lambdaClient = new LambdaClient({ region: outputs.Region });

for (const template of SEED_TEMPLATES) {
  let meta = await getTemplateMeta(template.id);
  if (!meta) {
    meta = await createTemplate(template, SEED_USER);
  }
  if (meta.status === 'published') {
    console.log(`${template.name} is published (v${meta.latestVersion})`);
    continue;
  }
  if (hasErrors(lintTemplate(template, { safeZone: DEFAULT_SAFE_ZONE }))) {
    console.log(`${template.name} has lint errors; open it in the builder`);
    continue;
  }
  meta = await publishVersion(meta, template, SEED_USER);
  console.log(`published ${template.name} v${meta.latestVersion}`);
}

let client = (await listAllClients()).find((item) => item.name === DEMO_CLIENT);
if (!client) {
  client = await createClient({
    name: DEMO_CLIENT,
    website: 'https://example.com',
    paymentRequired: false,
  });
  console.log(`created client ${DEMO_CLIENT}`);
}
if ((await listBrandKits(client.clientId)).length) {
  console.log('demo brand kit exists');
  process.exit(0);
}

async function upload(
  body: Buffer,
  kind: 'logo' | 'photo',
  name: string,
  contentType: string,
): Promise<string> {
  const assetId = newId();
  const now = new Date().toISOString();
  await saveAsset({
    assetId,
    clientId: client!.clientId,
    kind,
    name,
    status: 'pending',
    focalX: 0.5,
    focalY: 0.5,
    createdAt: now,
    createdBy: SEED_USER,
  });
  await s3Client.send(
    new PutObjectCommand({
      Bucket: outputs.AssetsBucketName,
      Key: uploadKey(client!.clientId, assetId),
      Body: body,
      ContentType: contentType,
    }),
  );
  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: outputs.ProcessUploadFunctionName,
      Payload: JSON.stringify({ clientId: client!.clientId, assetId }),
    }),
  );
  const result = JSON.parse(new TextDecoder().decode(response.Payload));
  if (!result.ok) {
    throw new Error(`could not process ${name}: ${result.message}`);
  }
  return assetId;
}

const logo = await sharp(
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="96"><rect x="4" y="16" width="64" height="64" rx="14" fill="#f4b942"/><circle cx="36" cy="48" r="18" fill="#8b3a3a"/><text x="84" y="60" font-family="Arial" font-size="30" font-weight="700" fill="#8b3a3a">Demo Bakery</text></svg>',
  ),
)
  .png()
  .toBuffer();
const photo = (hue: number) =>
  sharp({
    create: {
      width: 1600,
      height: 1000,
      channels: 3,
      background: { r: 200 - hue, g: 140, b: 90 + hue },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><circle cx="800" cy="500" r="320" fill="#ffffff" opacity="0.35"/></svg>`,
        ),
      },
    ])
    .jpeg()
    .toBuffer();
const logoId = await upload(logo, 'logo', 'Demo Bakery logo', 'image/png');
const photoIds = [
  await upload(await photo(0), 'photo', 'Shop front', 'image/jpeg'),
  await upload(await photo(60), 'photo', 'Cakes', 'image/jpeg'),
];
const now = new Date().toISOString();
await saveBrandKit({
  kitId: newId(),
  clientId: client.clientId,
  name: 'Demo Bakery',
  colors: { primary: '#8b3a3a', accent: '#f4b942', text: '#ffffff', background: '#fffaf3' },
  logoLightId: logoId,
  photoIds,
  services: [{ name: 'Birthday cakes', description: 'Made to order' }, { name: 'Sourdough bread' }],
  offers: [],
  ctas: ['Order now', 'Book a tasting'],
  updatedAt: now,
  updatedBy: SEED_USER,
});
console.log(`created the demo brand kit for ${DEMO_CLIENT}`);
