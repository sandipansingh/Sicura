import { it } from 'vitest';
import { Store } from '../../packages/store/src/index';
import { enqueueImport } from '../../packages/store/src/imports';
import { runNext } from '../../apps/worker/src/dispatch';
import { materializeRepository, repositoryFixtures } from '../support/repository-fixtures';
import { assertRepositoryFixture } from '../support/repository-fixture-checks';

it.each(repositoryFixtures)(
  'keeps %s coverage honest through the durable import queue',
  async (id) => {
    const fixture = await materializeRepository(id);
    const store = new Store(':memory:');
    try {
      const { job } = enqueueImport(
        store,
        {
          source: { kind: 'local', directory: fixture.directory },
          selection: null,
          retry_of: null,
        },
        id,
        true,
      );
      await runNext(store);
      assertRepositoryFixture(id, store, job);
    } finally {
      store.close();
      await fixture.dispose();
    }
  },
);
