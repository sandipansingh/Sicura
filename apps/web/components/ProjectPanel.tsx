import type { Dispatch, SetStateAction } from 'react';
import {
  validate,
  parseStrictJson,
  type ContractMap,
  type InputRequest,
} from '../../../packages/contracts/src/index';
import styles from './workbench.module.css';
import CredentialRescan from './CredentialRescan';
import RepositoryImport from './RepositoryImport';
type View = ContractMap['ProjectView'];
type Api = <K extends keyof ContractMap>(
  path: string,
  name: K,
  method?: string,
  body?: unknown,
) => Promise<ContractMap[K]>;
type Props = {
  busy: boolean;
  api: Api;
  load: (input: InputRequest) => Promise<void>;
  action: (fn: () => Promise<void>) => Promise<void>;
  view: View | null;
  setView: Dispatch<SetStateAction<View | null>>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  files: InputRequest['files'];
  setFiles: Dispatch<SetStateAction<InputRequest['files']>>;
  manifest: InputRequest['expectations'];
  setManifest: Dispatch<SetStateAction<InputRequest['expectations']>>;
};
export default function ProjectPanel({
  busy,
  api,
  load,
  action,
  view,
  setView,
  setSelected,
  files,
  setFiles,
  manifest,
  setManifest,
}: Props) {
  return (
    <>
      <RepositoryImport
        busy={busy}
        reports={view?.imports ?? []}
        api={api}
        action={action}
        onProject={async (id) => {
          setView(await api(`projects/${id}`, 'ProjectView'));
          setSelected(null);
        }}
      />
      <section className={styles.panel}>
        <h2>Analyze files</h2>
        <p>
          Ordered schema-only SQL, optional source/config, and an expectation manifest. Files stay
          in memory during admission. No production connection is requested.
        </p>
        <label className={styles.fileLabel}>
          Schema and source files
          <input
            type="file"
            multiple
            onChange={(e) =>
              void action(async () => {
                const chosen = Array.from(e.target.files ?? []);
                if (
                  chosen.length > 200 ||
                  chosen.some((f) => f.size > 2097152) ||
                  chosen.reduce((n, f) => n + f.size, 0) > 10485760
                )
                  throw new Error('INPUT_LIMIT');
                setFiles(
                  await Promise.all(
                    chosen.map(async (f) => ({
                      path: f.name,
                      kind: f.name.endsWith('.sql') ? ('sql' as const) : ('source' as const),
                      content: await f.text(),
                    })),
                  ),
                );
              })
            }
          />
        </label>
        <label className={styles.fileLabel}>
          Expectation manifest (optional)
          <input
            type="file"
            accept=".json"
            onChange={(e) =>
              void action(async () => {
                const f = e.target.files?.[0];
                if (f)
                  setManifest(
                    validate('ExpectationManifest', parseStrictJson(await f.text(), 65536)),
                  );
              })
            }
          />
        </label>
        <ol>
          {files.map((f, i) => (
            <li key={i}>
              File {i + 1} · {f.kind}{' '}
              <button
                disabled={i === 0}
                onClick={() =>
                  setFiles((prev) => {
                    const next = [...prev];
                    [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                    return next;
                  })
                }
              >
                Move earlier
              </button>
            </li>
          ))}
        </ol>
        {manifest && (
          <p>
            Manifest: {manifest.expectations.length} declared rules. By analyzing, you confirm these
            intended permissions.
          </p>
        )}
        <button
          disabled={busy || files.length === 0}
          onClick={() =>
            void action(async () =>
              load({
                files,
                sql_order: files.filter((f) => f.kind === 'sql').map((f) => f.path),
                expectations: manifest,
              }),
            )
          }
        >
          Analyze files
        </button>
      </section>
      {view && (
        <CredentialRescan
          view={view}
          busy={busy}
          api={api}
          action={action}
          onRefresh={async () => setView(await api(`projects/${view.project.id}`, 'ProjectView'))}
        />
      )}
      {view && (
        <section className={styles.panel}>
          <h2>Local data retention</h2>
          <p>
            Admitted secret-free SQL and redacted metadata expire after 24 hours. Replicas are
            destroyed after each job. Downloaded reports remain outside application control.
          </p>
          <button
            className={styles.danger}
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await api(`projects/${view.project.id}`, 'DeleteResponse', 'DELETE', {});
                setView(null);
                setSelected(null);
              })
            }
          >
            Delete local project
          </button>
        </section>
      )}
    </>
  );
}
