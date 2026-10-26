import { freezeDataset } from './dataset';
await freezeDataset();
console.log('Frozen eval/datasets/v1.manifest.json. Existing manifests are never overwritten.');
