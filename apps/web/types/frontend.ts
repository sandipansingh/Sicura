import type { ContractMap } from '../../../packages/contracts/src/index';

export type ApiClient = <K extends keyof ContractMap>(
  path: string,
  name: K,
  method?: string,
  body?: unknown,
) => Promise<ContractMap[K]>;

export type InvestigationTab = 'Project' | 'Findings' | 'Expected Access' | 'Verification Runs';
