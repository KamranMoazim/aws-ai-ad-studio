import { loadOutputs } from '../scripts/outputs.js';
import { check, finish } from './helpers.js';
import { describe, matrixCases, PRINCIPALS, SPOT_CHECKS } from './matrix.js';

loadOutputs();
const { allowedMany } = await import('../src/authz/authorize.js');

const cases = matrixCases();
const mismatches: string[] = [];
for (const [name, principal] of Object.entries(PRINCIPALS)) {
  const own = cases.filter((item) => item.principalName === name);
  const decisions = await allowedMany(principal, own);
  own.forEach((item, index) => {
    if (decisions[index] !== item.expected) {
      mismatches.push(`${describe(name, item.action, item.resource)} expected ${item.expected}`);
    }
  });
}
check(`policy store matches ${cases.length} matrix cases`, mismatches.length === 0, mismatches);

for (const [name, action, resource, expected] of SPOT_CHECKS) {
  const [decision] = await allowedMany(PRINCIPALS[name], [{ action, resource }]);
  check(
    `live ${describe(name, action, resource)} -> ${expected ? 'allow' : 'deny'}`,
    decision === expected,
  );
}
finish();
