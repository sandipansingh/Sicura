import type { Dispatch, SetStateAction } from 'react';
import type { Expectation, ExpectationEdit } from '../../../packages/contracts/src/index';
import styles from './workbench.module.css';
export default function ExpectationEditor({
  edits,
  setEdits,
  expectations,
  busy,
  onSave,
}: {
  edits: ExpectationEdit[];
  setEdits: Dispatch<SetStateAction<ExpectationEdit[]>>;
  expectations: Expectation[];
  busy: boolean;
  onSave: () => Promise<void>;
}) {
  return (
    <section className={styles.panel}>
      <h2>Declare intended access</h2>
      <p>
        Saving creates immutable expectation revisions, archives old comparisons and revokes patch
        approvals. SELECT public access does not modify writes. Team intent is stored; team
        verification is unavailable.
      </p>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>Resource</th>
              <th>Actor / operation</th>
              <th>Expected</th>
              <th>Owner / rationale</th>
              <th>Public</th>
            </tr>
          </thead>
          <tbody>
            {edits.map((e, i) => (
              <tr key={i}>
                <td>
                  {e.resource.schema}.{e.resource.table}
                </td>
                <td>
                  {e.actor} / {e.operation}
                </td>
                <td>
                  <select
                    aria-label={`Expected ${e.resource.table} ${e.actor} ${e.operation}`}
                    value={e.expected}
                    onChange={(event) =>
                      setEdits((prev) =>
                        prev.map((v, n) =>
                          n === i
                            ? {
                                ...v,
                                expected: event.target.value as ExpectationEdit['expected'],
                                intentionally_public: false,
                              }
                            : v,
                        ),
                      )
                    }
                  >
                    {[
                      'own_rows_only',
                      'all_rows',
                      'deny_all',
                      'unknown',
                      ...(e.expected === 'team_rows_only' ? ['team_rows_only'] : []),
                    ]
                      .filter((v) => v !== 'own_rows_only' || e.actor === 'authenticated')
                      .map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`Owner ${e.resource.table} ${e.actor} ${e.operation}`}
                    value={e.owner_column ?? ''}
                    onChange={(event) =>
                      setEdits((prev) =>
                        prev.map((v, n) =>
                          n === i ? { ...v, owner_column: event.target.value || null } : v,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label={`Rationale ${e.resource.table} ${e.actor} ${e.operation}`}
                    value={e.rationale}
                    onChange={(event) =>
                      setEdits((prev) =>
                        prev.map((v, n) => (n === i ? { ...v, rationale: event.target.value } : v)),
                      )
                    }
                  />
                  <small>
                    {expectations[i]?.source} r{expectations[i]?.revision}
                  </small>
                  {e.expected === 'team_rows_only' && (
                    <small>
                      Team proposal needs an explicit binding manifest before Save; team probes
                      remain unsupported.
                    </small>
                  )}
                </td>
                <td>
                  <input
                    aria-label={`Intentionally public ${e.resource.table} ${e.actor} ${e.operation}`}
                    type="checkbox"
                    disabled={e.expected !== 'all_rows'}
                    checked={e.intentionally_public}
                    onChange={(event) =>
                      setEdits((prev) =>
                        prev.map((v, n) =>
                          n === i ? { ...v, intentionally_public: event.target.checked } : v,
                        ),
                      )
                    }
                  />
                  {e.operation === 'SELECT' && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        setEdits((prev) =>
                          prev.map((v, n) =>
                            n === i
                              ? {
                                  ...v,
                                  expected: 'all_rows',
                                  owner_column: null,
                                  team_binding: null,
                                  intentionally_public: true,
                                  rationale:
                                    'Human declares this SELECT operation intentionally public',
                                }
                              : v,
                          ),
                        )
                      }
                    >
                      Public read preset
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button disabled={busy || !edits.length} onClick={() => void onSave()}>
        Save expectations
      </button>
    </section>
  );
}
