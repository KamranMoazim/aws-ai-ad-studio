import { loadOutputs } from './outputs.js';

loadOutputs();
const { SEED_TEMPLATES } = await import('../../shared/src/index.js');
const { createTemplate, getTemplateMeta, saveDraft } = await import('../src/data/templates.js');

const reset = process.argv.includes('--reset');
const only = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const SEED_USER = 'seed-script';

for (const template of SEED_TEMPLATES.filter((item) => !only.length || only.includes(item.id))) {
  const meta = await getTemplateMeta(template.id);
  if (!meta) {
    await createTemplate(template, SEED_USER);
    console.log(`created draft ${template.name}`);
  } else if (reset) {
    await saveDraft(meta, template, meta.revision, SEED_USER);
    console.log(`reset draft ${template.name}`);
  } else {
    console.log(`${template.name} exists`);
  }
}
console.log('open each template in the builder, run lint and publish it');
