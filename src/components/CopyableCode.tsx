import { useState, useRef, useEffect, type MouseEvent, type KeyboardEvent } from 'react';

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}

export interface CopyableCodeProps {
  code: string;
  displayText?: string;
  className?: string;
  title?: string;
  ariaLabel?: string;
}

export function CopyableCode({
  code,
  displayText,
  className = '',
  title,
  ariaLabel,
}: CopyableCodeProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const textToDisplay = displayText ?? code;

  const handleCopy = async (e?: MouseEvent | KeyboardEvent) => {
    if (e) {
      // If user was intentionally highlighting/selecting text, don't hijack with full copy
      const selection = window.getSelection()?.toString();
      if (selection && selection.length > 0) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    }

    const ok = await copyTextToClipboard(code);
    if (ok) {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
      setCopied(true);
      timeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        timeoutRef.current = null;
      }, 1500);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      handleCopy(e);
    }
  };

  const currentTitle = copied
    ? 'Copied to clipboard!'
    : (title ?? `${code}\n(Click to copy)`);

  return (
    <code
      className={`copyable-code${copied ? ' copied' : ''}${className ? ` ${className}` : ''}`}
      onClick={handleCopy}
      onKeyDown={handleKeyDown}
      title={currentTitle}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel ?? `Copy: ${code}`}
    >
      <span className="copyable-code-text">{textToDisplay}</span>
      <span className="copyable-code-action" aria-hidden="true">
        {copied ? (
          <span className="copyable-code-badge">
            <svg
              viewBox="0 0 16 16"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
            </svg>
            <span className="copyable-code-label">Copied!</span>
          </span>
        ) : (
          <svg
            className="copy-icon"
            viewBox="0 0 16 16"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="5" y="5" width="8" height="8" rx="1.5" />
            <path d="M3 11V3a1.5 1.5 0 0 1 1.5-1.5H11" />
          </svg>
        )}
      </span>
    </code>
  );
}
