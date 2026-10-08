'use client';

import React from 'react';

export type BadgeVariant =
  | 'confirmed'
  | 'suspected'
  | 'needs_expectation'
  | 'blocked'
  | 'not_reproduced'
  | 'not_testable'
  | 'fixed'
  | 'fix_not_verified'
  | 'ai_advisory'
  | 'verified_evidence'
  | 'static_evidence'
  | 'static_exposure'
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'info'
  | 'neutral'
  | 'outline'
  | 'green'
  | 'amber'
  | 'crimson'
  | 'cyan'
  | 'muted';

export interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  icon?: React.ReactNode;
  size?: 'sm' | 'md';
  style?: React.CSSProperties;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  children,
  icon,
  size = 'md',
  style,
  className = '',
}) => {
  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: size === 'sm' ? '10px' : '11px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    lineHeight: 1.2,
    padding: size === 'sm' ? '2px 6px' : '3px 8px',
    borderRadius: 'var(--radi)',
    border: '1px solid transparent',
    whiteSpace: 'nowrap',
    ...style,
  };

  const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
    confirmed: {
      backgroundColor: 'rgba(244, 63, 94, 0.15)',
      color: '#F43F5E',
      borderColor: '#F43F5E',
    },
    suspected: {
      backgroundColor: 'rgba(245, 158, 11, 0.15)',
      color: '#F59E0B',
      borderColor: '#F59E0B',
    },
    needs_expectation: {
      backgroundColor: 'rgba(245, 158, 11, 0.15)',
      color: '#F59E0B',
      borderColor: '#F59E0B',
    },
    blocked: {
      backgroundColor: 'rgba(244, 63, 94, 0.15)',
      color: '#F43F5E',
      borderColor: '#F43F5E',
    },
    not_reproduced: {
      backgroundColor: 'rgba(0, 229, 255, 0.12)',
      color: '#00e5ff',
      borderColor: '#00e5ff',
    },
    not_testable: {
      backgroundColor: 'rgba(136, 136, 136, 0.15)',
      color: '#888888',
      borderColor: '#555555',
    },
    fixed: {
      backgroundColor: 'rgba(16, 185, 129, 0.15)',
      color: '#10B981',
      borderColor: '#10B981',
    },
    fix_not_verified: {
      backgroundColor: 'rgba(244, 63, 94, 0.15)',
      color: '#F43F5E',
      borderColor: '#F43F5E',
    },
    ai_advisory: {
      backgroundColor: 'rgba(245, 158, 11, 0.15)',
      color: '#F59E0B',
      borderColor: '#F59E0B',
      fontWeight: 800,
    },
    verified_evidence: {
      backgroundColor: 'rgba(16, 185, 129, 0.15)',
      color: '#10B981',
      borderColor: '#10B981',
      fontWeight: 800,
    },
    static_evidence: {
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      color: 'var(--text-dim)',
      borderColor: 'var(--border-strong)',
    },
    static_exposure: {
      backgroundColor: 'rgba(245, 158, 11, 0.15)',
      color: '#F59E0B',
      borderColor: '#F59E0B',
    },
    critical: {
      backgroundColor: 'rgba(244, 63, 94, 0.2)',
      color: '#F43F5E',
      borderColor: '#F43F5E',
    },
    high: {
      backgroundColor: 'rgba(255, 102, 0, 0.2)',
      color: '#ff6600',
      borderColor: '#ff6600',
    },
    medium: {
      backgroundColor: 'rgba(245, 158, 11, 0.2)',
      color: '#F59E0B',
      borderColor: '#F59E0B',
    },
    low: {
      backgroundColor: 'rgba(136, 136, 136, 0.2)',
      color: '#888888',
      borderColor: '#555555',
    },
    info: {
      backgroundColor: 'rgba(0, 229, 255, 0.2)',
      color: '#00e5ff',
      borderColor: '#00e5ff',
    },
    neutral: {
      backgroundColor: 'rgba(136, 136, 136, 0.12)',
      color: 'var(--text-dim)',
      borderColor: 'var(--border-strong)',
    },
    outline: {
      backgroundColor: 'transparent',
      color: 'var(--text-dim)',
      borderColor: 'var(--border-strong)',
    },
    green: {
      backgroundColor: 'rgba(16, 185, 129, 0.15)',
      color: '#10B981',
      borderColor: '#10B981',
    },
    amber: {
      backgroundColor: 'rgba(245, 158, 11, 0.15)',
      color: '#F59E0B',
      borderColor: '#F59E0B',
    },
    crimson: {
      backgroundColor: 'rgba(244, 63, 94, 0.15)',
      color: '#F43F5E',
      borderColor: '#F43F5E',
    },
    cyan: {
      backgroundColor: 'rgba(0, 229, 255, 0.15)',
      color: '#00e5ff',
      borderColor: '#00e5ff',
    },
    muted: {
      backgroundColor: 'rgba(136, 136, 136, 0.12)',
      color: 'var(--text-dim)',
      borderColor: 'var(--border-strong)',
    },
  };

  return (
    <span style={{ ...baseStyle, ...variantStyles[variant] }} className={className}>
      {icon}
      {children}
    </span>
  );
};
