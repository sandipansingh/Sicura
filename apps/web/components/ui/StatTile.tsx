'use client';

import React from 'react';

export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  accentColor?: string;
  variant?: 'primary' | 'warn' | 'danger' | 'info' | 'muted';
  suffix?: string;
  className?: string;
  onClick?: () => void;
}

export const StatTile: React.FC<StatTileProps> = ({
  label,
  value,
  subtitle,
  badge,
  accentColor,
  variant,
  suffix,
  className = '',
  onClick,
}) => {
  let resolvedColor = accentColor;
  if (!resolvedColor && variant) {
    switch (variant) {
      case 'primary':
        resolvedColor = 'var(--accent-primary)';
        break;
      case 'warn':
        resolvedColor = 'var(--accent-warn)';
        break;
      case 'danger':
        resolvedColor = 'var(--accent-secondary)';
        break;
      case 'info':
        resolvedColor = 'var(--accent-info)';
        break;
      case 'muted':
        resolvedColor = 'var(--text-dim)';
        break;
    }
  }

  return (
    <div
      onClick={onClick}
      className={`stat-card ${className}`}
      style={{
        borderLeft: resolvedColor ? `4px solid ${resolvedColor}` : undefined,
        cursor: onClick ? 'pointer' : 'default',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: '0.8rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
        }}
      >
        <span className="stat-label">{label}</span>
        {badge}
      </div>

      <div
        className="stat-value"
        style={{
          color: resolvedColor || 'var(--text-main)',
          display: 'flex',
          alignItems: 'baseline',
        }}
      >
        <span>{value}</span>
        {suffix && (
          <span
            style={{
              fontSize: '0.85rem',
              color: 'var(--text-dim)',
              marginLeft: '6px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
            }}
          >
            {suffix}
          </span>
        )}
      </div>

      {subtitle && (
        <div
          style={{ fontSize: '0.85rem', color: 'var(--text-dim)', fontFamily: 'var(--font-body)' }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
};
