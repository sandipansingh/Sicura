import { readFile, writeFile } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';

const schema = JSON.parse(await readFile('packages/contracts/contracts.schema.json', 'utf8'));
const output = await compile(
  { ...schema, anyOf: Object.keys(schema.$defs).map((key) => ({ $ref: `#/$defs/${key}` })) },
  'Contracts',
  {
    bannerComment: '/* Generated from contracts.schema.json. Do not edit. */',
    additionalProperties: false,
    ignoreMinAndMaxItems: true,
  },
);
await writeFile('packages/contracts/src/generated.ts', output);
