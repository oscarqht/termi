import React from 'react';
import { useSystemTheme } from '../../hooks/useSystemTheme';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'info' | 'success' | 'warning' | 'default' | 'danger';
  style?: React.CSSProperties;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  style,
  className,
}) => {
  const { isDark } = useSystemTheme();

  const getStyles = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      fontSize: '11px',
      fontWeight: 600,
      borderRadius: '9999px',
      letterSpacing: '0.025em',
      textTransform: 'uppercase',
      transition: 'background-color 0.2s ease, color 0.2s ease',
      lineHeight: '1.4',
    };

    const variantStyles: Record<string, React.CSSProperties> = isDark
      ? {
          default: { backgroundColor: 'rgba(255, 255, 255, 0.08)', color: '#94a3b8', border: '1px solid rgba(255, 255, 255, 0.06)' },
          info: { backgroundColor: 'rgba(2, 132, 199, 0.2)', color: '#38bdf8', border: '1px solid rgba(2, 132, 199, 0.3)' },
          success: { backgroundColor: 'rgba(34, 197, 94, 0.18)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.25)' },
          warning: { backgroundColor: 'rgba(234, 179, 8, 0.18)', color: '#fde047', border: '1px solid rgba(234, 179, 8, 0.25)' },
          danger: { backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)' },
        }
      : {
          default: { backgroundColor: '#e2e8f0', color: '#475569', border: '1px solid #cbd5e1' },
          info: { backgroundColor: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' },
          success: { backgroundColor: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' },
          warning: { backgroundColor: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' },
          danger: { backgroundColor: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca' },
        };

    return {
      ...base,
      ...variantStyles[variant],
      ...style,
    };
  };

  return (
    <span className={className} style={getStyles()}>
      {children}
    </span>
  );
};
