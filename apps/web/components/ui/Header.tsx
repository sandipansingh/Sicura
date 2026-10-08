'use client';
import Link from 'next/link';
import type { Job } from '../../../../packages/contracts/src/index';
import type { InvestigationTab } from '../../types/frontend';

export interface HeaderProps {
  currentTab?: InvestigationTab;
  onTabChange?: (tab: InvestigationTab) => void;
  projectName?: string;
  inputRevision?: number;
  activeJob?: Job;
  onCancelJob?: () => void;
  isAppView?: boolean;
}
const tabs: InvestigationTab[] = ['Project', 'Findings', 'Expected Access', 'Verification Runs'];
export function Header({
  currentTab,
  onTabChange,
  projectName,
  inputRevision,
  activeJob,
  onCancelJob,
  isAppView = false,
}: HeaderProps) {
  return (
    <header className="app-header">
      <div className="container header-content">
        <div className="header-identity">
          <Link href="/" className="logo" aria-label="Sicura">
            <span className="logo-initial" aria-hidden="true">
              S
            </span>
            SI<span className="logo-accent">CURA</span>
          </Link>
          {isAppView && projectName && (
            <div className="project-identity">
              <span>{projectName}</span>
              <small>Input revision {inputRevision}</small>
            </div>
          )}
        </div>
        <nav className="header-nav" aria-label="Main navigation">
          {isAppView ? (
            tabs.map((tab) => (
              <button
                key={tab}
                aria-label={tab}
                aria-current={currentTab === tab ? 'page' : undefined}
                onClick={() => onTabChange?.(tab)}
                className={`nav-link ${currentTab === tab ? 'active-link' : ''}`}
              >
                {tab}
              </button>
            ))
          ) : (
            <>
              <Link href="/" className="nav-link active-link">
                Overview
              </Link>
              <Link href="/app" className="nav-link">
                Workbench
              </Link>
            </>
          )}
        </nav>
        {activeJob && (
          <div className="job-status" role="status">
            <span>
              {activeJob.error_code === 'CANCELLED'
                ? 'Cancellation requested; waiting for cleanup.'
                : `${activeJob.phase} · ${activeJob.status}`}
            </span>
            <button disabled={activeJob.error_code === 'CANCELLED'} onClick={onCancelJob}>
              Cancel job
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
