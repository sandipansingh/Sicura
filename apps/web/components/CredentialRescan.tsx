import { useState } from 'react';
import type { ContractMap, InputRequest } from '../../../packages/contracts/src/index';
import styles from './workbench.module.css';
type Props = {
  view: ContractMap['ProjectView'];
  busy: boolean;
  api: <K extends keyof ContractMap>(
    path: string,
    name: K,
    method?: string,
    body?: unknown,
  ) => Promise<ContractMap[K]>;
  action: (fn: () => Promise<void>) => Promise<void>;
  onRefresh: () => Promise<void>;
};
export default function CredentialRescan({ view, busy, api, action, onRefresh }: Props) {
  const [files, setFiles] = useState<InputRequest['files']>([]);
  const [deleted, setDeleted] = useState<string[]>([]);
  const [complete, setComplete] = useState(false);
  const paths = view.input_manifest.filter((f) => f.kind === 'source').map((f) => f.path);
  if (!paths.length) return null;
  return (
    <section className={styles.panel}>
      <h2>Rescan complete source scope</h2>
      <p>
        Provide each replacement file or explicitly record its deletion. This checks submitted
        exposure only; rotation and published artifacts remain unverified.
      </p>
      {paths.map((path) => (
        <div key={path}>
          <label>
            {path}
            <input
              type="file"
              disabled={busy || deleted.includes(path)}
              onChange={(e) =>
                void action(async () => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 2097152) throw new Error('INPUT_LIMIT');
                  const content = await f.text();
                  setFiles((prev) => [
                    ...prev.filter((x) => x.path !== path),
                    { path, kind: 'source', content },
                  ]);
                })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={deleted.includes(path)}
              disabled={busy}
              onChange={(e) => {
                setDeleted((prev) =>
                  e.target.checked ? [...prev, path] : prev.filter((x) => x !== path),
                );
                setFiles((prev) => prev.filter((x) => x.path !== path));
              }}
            />
            This path was deleted
          </label>
        </div>
      ))}
      <label>
        <input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} />
        These files and deletions describe the complete submitted source scope
      </label>
      <button
        disabled={
          busy ||
          !complete ||
          paths.some((p) => !deleted.includes(p) && !files.some((f) => f.path === p))
        }
        onClick={() =>
          void action(async () => {
            await api(`projects/${view.project.id}/rescan-credentials`, 'JobEnvelope', 'POST', {
              expected_input_revision: view.project.input_revision,
              complete: true,
              deleted_paths: deleted,
              files,
            });
            setFiles([]);
            setDeleted([]);
            setComplete(false);
            await onRefresh();
          })
        }
      >
        Confirm complete scope and rescan
      </button>
    </section>
  );
}
