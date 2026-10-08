import { Store } from './index';
import { validate } from '../../contracts/src/index';
import lock from '../../../config/runtime-lock.json';

export function enqueueProjectAnalysis(store: Store, id: string, key: string) {
  const p = store.get('Project', id);
  const job = store.enqueue(p, 'project_analysis', 'investigate', key, {
    finding_id: null,
    patch_id: null,
    expected_finding_revision: null,
    expectation_set_revision: p.expectation_set_revision,
  });
  const prior = store.list('ProjectSummary', id).find((s) => s.id === job.id);
  if (!prior)
    store.put(
      'ProjectSummary',
      job.id,
      id,
      validate('ProjectSummary', {
        id: job.id,
        input_revision: p.input_revision,
        expectation_set_revision: p.expectation_set_revision,
        status: 'pending',
        model: lock.ollama_model,
        model_digest: lock.ollama_model_digest,
        prompt_version: 'project-1',
        output: null,
        reason_code: null,
        duration_ms: 0,
        created_at: new Date().toISOString(),
      }),
    );
  return { job };
}
export function enqueueAutomaticAnalysis(store: Store, id: string) {
  const p = store.get('Project', id);
  const key = `auto-summary-${p.input_revision}-${p.expectation_set_revision}-${lock.ollama_model_digest}-project-1`;
  if (!store.jobs(id).some((j) => j.idempotency_key === key))
    enqueueProjectAnalysis(store, id, key);
}
