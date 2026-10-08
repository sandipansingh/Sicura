'use client';

import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  open?: boolean;
  isOpen?: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth = '640px',
}) => {
  const isModalOpen = Boolean(open ?? isOpen);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const background = isModalOpen
      ? Array.from(document.querySelectorAll<HTMLElement>('main, header, footer')).map(
          (element) => ({
            element,
            inert: element.inert,
            hidden: element.getAttribute('aria-hidden'),
          }),
        )
      : [];
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Tab') {
        const elements = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ) ?? [],
        ).filter((element) => element.offsetParent !== null);
        const first = elements[0];
        const last = elements.at(-1);
        if (!first || !last) {
          e.preventDefault();
          panel.current?.focus();
        } else if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === panel.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    if (isModalOpen) {
      for (const { element } of background) {
        element.inert = true;
        element.setAttribute('aria-hidden', 'true');
      }
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
      panel.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      for (const { element, inert, hidden } of background) {
        element.inert = inert;
        if (hidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', hidden);
      }
      window.removeEventListener('keydown', handleKeyDown);
      if (isModalOpen) previousFocus?.focus();
    };
  }, [isModalOpen, onClose]);

  if (!isModalOpen) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        backgroundColor: 'rgba(5, 5, 5, 0.85)',
        backdropFilter: 'var(--glass-bf)',
        WebkitBackdropFilter: 'var(--glass-bf)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        style={{
          width: '100%',
          maxWidth,
          backgroundColor: 'var(--bg-subtle)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radi)',
          boxShadow: '12px 12px 0px rgba(0, 0, 0, 0.8)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
      >
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid var(--border-strong)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <div>
            <h2
              id={titleId}
              style={{
                margin: 0,
                fontSize: '1.6rem',
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: 'var(--text-main)',
              }}
            >
              {title}
            </h2>
            {subtitle && (
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: '0.85rem',
                  fontFamily: 'var(--font-body)',
                  color: 'var(--text-dim)',
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: 'none',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-dim)',
              fontSize: '16px',
              cursor: 'pointer',
              padding: '2px 8px',
              borderRadius: 'var(--radi)',
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.2,
            }}
          >
            [X]
          </button>
        </div>
        <div style={{ padding: '24px', overflowY: 'auto' }}>{children}</div>
        {footer && (
          <div
            style={{
              padding: '16px 24px',
              borderTop: '1px solid var(--border-strong)',
              backgroundColor: 'rgba(0, 0, 0, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '12px',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
