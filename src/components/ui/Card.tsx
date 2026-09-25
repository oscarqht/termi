import React from 'react';
import { useSystemTheme } from '../../hooks/useSystemTheme';

export interface CardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  icon?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  badge,
  icon,
  extra,
  children,
  style,
  className = '',
}) => {
  const { isDark } = useSystemTheme();

  return (
    <div
      className={`arcable-card ${className}`}
      style={{
        backgroundColor: isDark ? '#151e2e' : '#ffffff',
        border: isDark ? '1px solid #243247' : '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '1.25rem',
        boxShadow: isDark
          ? '0 4px 20px -2px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.04)'
          : '0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.02)',
        transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
        ...style,
      }}
    >
      {(title || extra || subtitle || icon || badge) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
            borderBottom: isDark ? '1px solid rgba(255, 255, 255, 0.06)' : '1px solid #f1f5f9',
            paddingBottom: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0, flex: 1 }}>
            {icon && (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isDark ? '#38bdf8' : '#0284c7',
                  flexShrink: 0,
                }}
              >
                {icon}
              </span>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                {title && (
                  <h3
                    style={{
                      margin: 0,
                      fontSize: '1rem',
                      fontWeight: 600,
                      letterSpacing: '-0.01em',
                      color: isDark ? '#f8fafc' : '#0f172a',
                    }}
                  >
                    {title}
                  </h3>
                )}
                {badge}
              </div>
              {subtitle && (
                <p
                  style={{
                    margin: '3px 0 0',
                    fontSize: '0.8rem',
                    color: isDark ? '#94a3b8' : '#64748b',
                  }}
                >
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {extra && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              {extra}
            </div>
          )}
        </div>
      )}
      <div>{children}</div>
    </div>
  );
};
