'use client';

import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  style,
  className = '',
  ...props
}) => {
  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontFamily: 'var(--font-body)',
    fontWeight: 700,
    fontSize: size === 'sm' ? '0.8rem' : size === 'lg' ? '1.05rem' : '0.9rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    borderRadius: 'var(--radi)',
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    opacity: disabled || loading ? 0.6 : 1,
    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
    border: '1px solid transparent',
    padding: size === 'sm' ? '6px 12px' : size === 'lg' ? '14px 28px' : '9px 18px',
    outline: 'none',
    userSelect: 'none',
    ...style,
  };

  const variantStyles: Record<string, React.CSSProperties> = {
    primary: {
      backgroundColor: 'var(--text-main)',
      color: 'var(--bg-deep)',
      borderColor: 'var(--text-main)',
      boxShadow: '4px 4px 0px rgba(51, 51, 51, 0.7)',
    },
    secondary: {
      backgroundColor: 'var(--bg-subtle)',
      color: 'var(--text-main)',
      borderColor: 'var(--border-strong)',
      boxShadow: '4px 4px 0px rgba(0, 0, 0, 0.5)',
    },
    outline: {
      backgroundColor: 'transparent',
      color: 'var(--text-main)',
      borderColor: 'var(--border-strong)',
    },
    ghost: {
      backgroundColor: 'transparent',
      color: 'var(--text-dim)',
      borderColor: 'transparent',
    },
    danger: {
      backgroundColor: 'rgba(244, 63, 94, 0.15)',
      color: '#F43F5E',
      borderColor: '#F43F5E',
      boxShadow: '4px 4px 0px rgba(244, 63, 94, 0.25)',
    },
  };

  return (
    <button
      style={{ ...baseStyle, ...variantStyles[variant] }}
      disabled={disabled || loading}
      className={`btn-brutalist ${className}`}
      onMouseEnter={(e) => {
        if (disabled || loading) return;
        if (variant === 'primary') {
          e.currentTarget.style.backgroundColor = 'var(--accent-primary)';
          e.currentTarget.style.color = '#000000';
          e.currentTarget.style.borderColor = 'var(--accent-primary)';
          e.currentTarget.style.boxShadow = '4px 4px 0px rgba(16, 185, 129, 0.4)';
        } else if (variant === 'secondary' || variant === 'outline') {
          e.currentTarget.style.borderColor = 'var(--accent-primary)';
          e.currentTarget.style.color = 'var(--accent-primary)';
        } else if (variant === 'ghost') {
          e.currentTarget.style.color = 'var(--text-main)';
        }
      }}
      onMouseLeave={(e) => {
        if (disabled || loading) return;
        const orig = variantStyles[variant] || {};
        e.currentTarget.style.backgroundColor = (orig.backgroundColor as string) || '';
        e.currentTarget.style.color = (orig.color as string) || '';
        e.currentTarget.style.borderColor = (orig.borderColor as string) || '';
        e.currentTarget.style.boxShadow = (orig.boxShadow as string) || '';
      }}
      {...props}
    >
      {loading ? (
        <span
          style={{
            display: 'inline-block',
            width: '12px',
            height: '12px',
            border: '2px solid currentColor',
            borderRightColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.6s linear infinite',
          }}
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
};
