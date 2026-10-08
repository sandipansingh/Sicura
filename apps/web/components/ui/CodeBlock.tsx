'use client';

import React, { useState } from 'react';

export interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  maxHeight?: string;
  style?: React.CSSProperties;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language = 'sql',
  filename,
  maxHeight = '320px',
  style,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      style={{
        borderRadius: 'var(--radi)',
        border: '1px solid var(--border-strong)',
        backgroundColor: 'var(--bg-deep)',
        overflow: 'hidden',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          borderBottom: '1px solid var(--border-strong)',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              fontSize: '10px',
              textTransform: 'uppercase',
              color: 'var(--accent-primary)',
              fontWeight: 700,
              letterSpacing: '0.1em',
            }}
          >
            // {language}
          </span>
          {filename && (
            <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>{filename}</span>
          )}
        </div>
        <button
          onClick={handleCopy}
          style={{
            background: 'none',
            border: '1px solid var(--border-strong)',
            color: copied ? 'var(--accent-primary)' : 'var(--text-dim)',
            fontSize: '10px',
            fontFamily: 'var(--font-body)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            cursor: 'pointer',
            padding: '3px 8px',
            borderRadius: 'var(--radi)',
            transition: 'all 0.2s ease',
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '14px 16px',
          overflowX: 'auto',
          maxHeight,
          color: 'var(--text-main)',
          lineHeight: 1.6,
          letterSpacing: '-0.02em',
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
};
