import React, { useState } from 'react';
import { useSystemTheme } from '../../hooks/useSystemTheme';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled,
  style,
  onMouseEnter,
  onMouseLeave,
  className,
  ...props
}) => {
  const { isDark } = useSystemTheme();
  const [isHovered, setIsHovered] = useState(false);

  const isDisabled = disabled || isLoading;

  const getStyles = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
      fontWeight: 500,
      borderRadius: '7px',
      cursor: isDisabled ? 'not-allowed' : 'pointer',
      opacity: isDisabled ? 0.6 : 1,
      transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
      border: '1px solid transparent',
      fontFamily: 'inherit',
      textDecoration: 'none',
      boxSizing: 'border-box',
      outline: 'none',
      userSelect: 'none',
      whiteSpace: 'nowrap',
    };

    const sizeStyles: Record<string, React.CSSProperties> = {
      sm: { padding: '4px 10px', fontSize: '12px', height: '28px' },
      md: { padding: '6px 14px', fontSize: '13px', height: '34px' },
      lg: { padding: '10px 20px', fontSize: '15px', height: '42px' },
    };

    const variantStyles: Record<string, React.CSSProperties> = isDark
      ? {
          primary: {
            backgroundColor: isHovered && !isDisabled ? '#0284c7' : '#0369a1',
            color: '#ffffff',
            borderColor: isHovered && !isDisabled ? '#38bdf8' : '#0284c7',
            boxShadow: isHovered && !isDisabled ? '0 0 12px rgba(2, 132, 199, 0.35)' : '0 1px 2px rgba(0, 0, 0, 0.3)',
          },
          secondary: {
            backgroundColor: isHovered && !isDisabled ? '#243247' : '#1e293b',
            color: '#f8fafc',
            borderColor: isHovered && !isDisabled ? '#3b4f6d' : '#2d3e58',
          },
          outline: {
            backgroundColor: isHovered && !isDisabled ? 'rgba(56, 189, 248, 0.1)' : 'transparent',
            color: '#38bdf8',
            borderColor: isHovered && !isDisabled ? '#38bdf8' : 'rgba(56, 189, 248, 0.4)',
          },
          danger: {
            backgroundColor: isHovered && !isDisabled ? '#dc2626' : '#b91c1c',
            color: '#ffffff',
            borderColor: isHovered && !isDisabled ? '#ef4444' : '#dc2626',
          },
          ghost: {
            backgroundColor: isHovered && !isDisabled ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
            color: isHovered && !isDisabled ? '#f8fafc' : '#94a3b8',
            borderColor: 'transparent',
          },
        }
      : {
          primary: {
            backgroundColor: isHovered && !isDisabled ? '#0369a1' : '#0284c7',
            color: '#ffffff',
            borderColor: isHovered && !isDisabled ? '#0284c7' : '#0369a1',
            boxShadow: isHovered && !isDisabled ? '0 2px 8px rgba(2, 132, 199, 0.25)' : '0 1px 2px rgba(0, 0, 0, 0.05)',
          },
          secondary: {
            backgroundColor: isHovered && !isDisabled ? '#e2e8f0' : '#f1f5f9',
            color: '#1e293b',
            borderColor: isHovered && !isDisabled ? '#cbd5e1' : '#e2e8f0',
          },
          outline: {
            backgroundColor: isHovered && !isDisabled ? 'rgba(2, 132, 199, 0.06)' : 'transparent',
            color: '#0284c7',
            borderColor: isHovered && !isDisabled ? '#0284c7' : 'rgba(2, 132, 199, 0.5)',
          },
          danger: {
            backgroundColor: isHovered && !isDisabled ? '#dc2626' : '#ef4444',
            color: '#ffffff',
            borderColor: isHovered && !isDisabled ? '#ef4444' : '#dc2626',
          },
          ghost: {
            backgroundColor: isHovered && !isDisabled ? 'rgba(0, 0, 0, 0.05)' : 'transparent',
            color: isHovered && !isDisabled ? '#0f172a' : '#64748b',
            borderColor: 'transparent',
          },
        };

    return {
      ...base,
      ...sizeStyles[size],
      ...variantStyles[variant],
      ...style,
    };
  };

  return (
    <button
      disabled={isDisabled}
      style={getStyles()}
      className={className}
      onMouseEnter={(e) => {
        setIsHovered(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setIsHovered(false);
        onMouseLeave?.(e);
      }}
      {...props}
    >
      {isLoading ? (
        <>
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            style={{ animation: 'spin 0.8s linear infinite' }}
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeDasharray="42"
              strokeDashoffset="14"
              strokeLinecap="round"
            />
          </svg>
          <span>Loading...</span>
        </>
      ) : (
        children
      )}
    </button>
  );
};
