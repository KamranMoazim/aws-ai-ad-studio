import { writeFileSync } from 'node:fs';
import { loadOutputs } from './outputs.js';

const outputs = loadOutputs();
const target = new URL('../../client/public/config.json', import.meta.url);
writeFileSync(
  target,
  JSON.stringify(
    {
      region: outputs.Region,
      apiUrl: process.env.API_URL ?? outputs.ApiUrl,
      userPoolId: outputs.UserPoolId,
      userPoolClientId: outputs.UserPoolClientId,
    },
    null,
    2,
  ),
);
console.log('wrote client/public/config.json');
