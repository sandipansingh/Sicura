'use client';

import React from 'react';
import type { Job } from '../../../../packages/contracts/src/index';
import type { InvestigationTab } from '../../types/frontend';
import { Header } from './Header';
import { Footer } from './Footer';

export interface AppShellProps {
  children: React.ReactNode;
  currentTab: InvestigationTab;
  onTabChange: (tab: InvestigationTab) => void;
  projectName?: string;
  inputRevision?: number;
  activeJob?: Job;
  onCancelJob?: () => void;
}

export const AppShell: React.FC<AppShellProps> = ({
  children,
  currentTab,
  onTabChange,
  projectName,
  inputRevision,
  activeJob,
  onCancelJob,
}) => {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-deep)',
        position: 'relative',
      }}
    >
      <div className="grid-overlay" />
      <div className="noise-overlay" />

      {/* Top Application Header */}
      <Header
        isAppView={true}
        currentTab={currentTab}
        onTabChange={onTabChange}
        projectName={projectName}
        inputRevision={inputRevision}
        activeJob={activeJob}
        onCancelJob={onCancelJob}
      />

      {/* Main Screen Content Viewport */}
      <main
        className="container"
        style={{
          flex: 1,
          paddingTop: '2rem',
          paddingBottom: '5rem',
          position: 'relative',
          zIndex: 10,
        }}
      >
        {children}
      </main>

      {/* Application footer */}
      <Footer />
    </div>
  );
};
