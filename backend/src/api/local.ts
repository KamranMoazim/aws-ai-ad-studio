import { serve } from '@hono/node-server';
import { loadOutputs } from '../../scripts/outputs.js';

loadOutputs();
const { app } = await import('./app.js');
const PORT = Number(process.env.PORT ?? 4000);

serve({ fetch: app.fetch, port: PORT }, () => console.log(`api on http://localhost:${PORT}`));
