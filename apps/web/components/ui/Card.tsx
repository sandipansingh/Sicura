'use client';

import React from 'react';

export interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'elevated' | 'sunken' | 'ai' | 'verified' | 'static';
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  badge?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'default',
  title,
  subtitle,
  action,
  badge,
  style,
  className = '',
  id,
}) => {
  const getVariantStyles = (): React.CSSProperties => {
    switch (variant) {
      case 'elevated':
        return {
          backgroundColor: 'var(--bg-subtle)',
          borderColor: 'var(--border-strong)',
          boxShadow: '8px 8px 0px rgba(0, 0, 0, 0.6)',
        };
      case 'sunken':
        return {
          backgroundColor: 'var(--bg-deep)',
          borderColor: 'var(--border-strong)',
        };
      case 'ai':
        return {
          backgroundColor: 'var(--bg-subtle)',
          borderColor: 'var(--border-strong)',
          borderLeft: '5px solid var(--accent-warn)',
        };
      case 'verified':
        return {
          backgroundColor: 'var(--bg-subtle)',
          borderColor: 'var(--border-strong)',
          borderLeft: '5px solid var(--accent-primary)',
        };
      case 'static':
        return {
          backgroundColor: 'var(--bg-subtle)',
          borderColor: 'var(--border-strong)',
        };
      default:
        return {
          backgroundColor: 'var(--bg-subtle)',
          borderColor: 'var(--border-strong)',
        };
    }
  };

  return (
    <section
      id={id}
      className={`card-brutalist ${variant === 'ai' ? 'card-ai-advisory' : ''} ${
        variant === 'verified' ? 'card-verified-evidence' : ''
      } ${className}`}
      style={{
        borderRadius: 'var(--radi)',
        border: '1px solid var(--border-strong)',
        overflow: 'hidden',
        transition: 'border-color 0.2s ease',
        ...getVariantStyles(),
        ...style,
      }}
    >
      {(title || subtitle || action || badge) && (
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border-strong)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {badge}
              {typeof title === 'string' ? (
                <h3
                  style={{
                    margin: 0,
                    fontSize: '1.4rem',
                    fontFamily: 'var(--font-display)',
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: 'var(--text-main)',
                  }}
                >
                  {title}
                </h3>
              ) : (
                title
              )}
            </div>
            {subtitle && (
              <p
                style={{
                  margin: 0,
                  fontSize: '0.85rem',
                  fontFamily: 'var(--font-body)',
                  color: 'var(--text-dim)',
                  lineHeight: 1.4,
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
          {action && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>{action}</div>
          )}
        </div>
      )}
      <div style={{ padding: '20px' }}>{children}</div>
    </section>
  );
};
