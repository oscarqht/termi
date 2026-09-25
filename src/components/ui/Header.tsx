import React from 'react';
import { useSystemTheme } from '../../hooks/useSystemTheme';

export interface HeaderProps {
  title?: string;
  subtitle?: string;
  iconSrc?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

export const Header: React.FC<HeaderProps> = ({
  title = 'termi',
  subtitle = 'A cross-platform status bar terminal app',
  iconSrc = '/app-icon.png',
  badge,
  actions,
  style,
  className = '',
}) => {
  const { isDark } = useSystemTheme();

  return (
    <header
      className={`arcable-header ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.875rem 0',
        marginBottom: '1.25rem',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0 }}>
        {iconSrc && (
          <img
            src={iconSrc}
            alt={title}
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              objectFit: 'contain',
              display: 'block',
              flexShrink: 0,
              boxShadow: isDark
                ? '0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.08)'
                : '0 2px 8px rgba(0, 0, 0, 0.1)',
            }}
          />
        )}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h1
              style={{
                margin: 0,
                fontSize: '1.75rem',
                fontWeight: 700,
                letterSpacing: '-0.025em',
                lineHeight: 1.2,
                color: isDark ? '#f8fafc' : '#0f172a',
              }}
            >
              {title}
            </h1>
            {badge}
          </div>
          {subtitle && (
            <p
              style={{
                margin: '2px 0 0',
                fontSize: '0.85rem',
                color: isDark ? '#94a3b8' : '#64748b',
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexShrink: 0 }}>
          {actions}
        </div>
      )}
    </header>
  );
};
