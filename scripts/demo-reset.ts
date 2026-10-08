import { Store } from '../packages/store/src/index';
import { reconcileReplicas } from '../packages/core/src/replica/manager';
const store = new Store();
try {
  if (store.jobs().some((j) => j.status === 'running' || j.status === 'queued'))
    throw new Error('PROJECT_BUSY');
  for (const p of store.list('Project')) store.deleteProject(p.id);
  await reconcileReplicas();
  console.log('PASS reset local project metadata; import a repository or upload files to begin');
} finally {
  store.close();
}
