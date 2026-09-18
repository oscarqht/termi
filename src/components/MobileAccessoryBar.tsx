import { type FC, type MouseEvent, type TouchEvent } from 'react';

interface MobileAccessoryBarProps {
  onSendKey: (data: string) => void;
  ctrlActive: boolean;
  setCtrlActive: (updater: (prev: boolean) => boolean) => void;
  altActive: boolean;
  setAltActive: (updater: (prev: boolean) => boolean) => void;
  onToggleKeyboard: () => void;
  collapsed: boolean;
  setCollapsed: (updater: (prev: boolean) => boolean) => void;
}

export const MobileAccessoryBar: FC<MobileAccessoryBarProps> = ({
  onSendKey,
  ctrlActive,
  setCtrlActive,
  altActive,
  setAltActive,
  onToggleKeyboard,
  collapsed,
  setCollapsed,
}) => {
  // Prevent button taps from blurring the xterm helper textarea and closing the virtual keyboard
  const preventBlur = (e: MouseEvent | TouchEvent) => {
    e.preventDefault();
  };

  const handleKeyClick = (data: string) => {
    onSendKey(data);
  };

  return (
    <div className={`mobile-accessory-bar-wrapper${collapsed ? ' collapsed' : ''}`}>
      <button
        type="button"
        className="mobile-bar-toggle"
        onMouseDown={preventBlur}
        onTouchStart={preventBlur}
        onClick={() => setCollapsed((prev) => !prev)}
        aria-label={collapsed ? 'Show mobile terminal keys' : 'Hide mobile terminal keys'}
        title={collapsed ? 'Show mobile terminal keys' : 'Hide mobile terminal keys'}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {collapsed ? (
            <polyline points="18 15 12 9 6 15" />
          ) : (
            <polyline points="6 9 12 15 18 9" />
          )}
        </svg>
      </button>

      {!collapsed && (
        <div className="mobile-accessory-bar" role="toolbar" aria-label="Terminal mobile keys">
          {/* Keyboard focus toggle button */}
          <button
            type="button"
            className="mobile-key-btn icon"
            onMouseDown={preventBlur}
            onTouchStart={preventBlur}
            onClick={onToggleKeyboard}
            aria-label="Toggle keyboard"
            title="Toggle keyboard"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
              <line x1="6" y1="8" x2="6.01" y2="8" />
              <line x1="10" y1="8" x2="10.01" y2="8" />
              <line x1="14" y1="8" x2="14.01" y2="8" />
              <line x1="18" y1="8" x2="18.01" y2="8" />
              <line x1="6" y1="12" x2="6.01" y2="12" />
              <line x1="10" y1="12" x2="10.01" y2="12" />
              <line x1="14" y1="12" x2="14.01" y2="12" />
              <line x1="18" y1="12" x2="18.01" y2="12" />
              <line x1="7" y1="16" x2="17" y2="16" />
            </svg>
          </button>

          {/* ESC */}
          <button
            type="button"
            className="mobile-key-btn"
            onMouseDown={preventBlur}
            onTouchStart={preventBlur}
            onClick={() => handleKeyClick('\x1b')}
          >
            ESC
          </button>

          {/* TAB */}
          <button
            type="button"
            className="mobile-key-btn"
            onMouseDown={preventBlur}
            onTouchStart={preventBlur}
            onClick={() => handleKeyClick('\t')}
          >
            TAB
          </button>

          {/* CTRL Sticky */}
          <button
            type="button"
            className={`mobile-key-btn${ctrlActive ? ' active' : ''}`}
            onMouseDown={preventBlur}
            onTouchStart={preventBlur}
            onClick={() => setCtrlActive((prev) => !prev)}
            aria-pressed={ctrlActive}
          >
            CTRL
          </button>

          {/* ALT Sticky */}
          <button
            type="button"
            className={`mobile-key-btn${altActive ? ' active' : ''}`}
            onMouseDown={preventBlur}
            onTouchStart={preventBlur}
            onClick={() => setAltActive((prev) => !prev)}
            aria-pressed={altActive}
          >
            ALT
          </button>

          {/* Quick Ctrl+C */}
          <button
            type="button"
            className="mobile-key-btn ctrl-c-btn"
            onMouseDown={preventBlur}
            onTouchStart={preventBlur}
            onClick={() => handleKeyClick('\x03')}
            title="Send SIGINT (Ctrl+C)"
          >
            ^C
          </button>

          {/* Arrows */}
          <button
            type="button"
            className="mobile-key-btn"
            onMouseDown={preventBlur}
            onTouchStart={preventBlur}
            onClick={() => handleKeyClick('\x1b[A')}
            aria-label="Up arrow"
          >
            ↑
          </button>
          <button
            type="button"
            className="mobile-key-btn"
            onMouseDown={preventBlur}
            onTouchStart={preventBlur}
            onClick={() => handleKeyClick('\x1b[B')}
            aria-label="Down arrow"
          >
            ↓
          </button>
          <button
            type="button"
            className="mobile-key-btn"
            onMouseDown={preventBlur}
            onTouchStart={preventBlur}
            onClick={() => handleKeyClick('\x1b[D')}
            aria-label="Left arrow"
          >
            ←
          </button>
          <button
            type="button"
            className="mobile-key-btn"
            onMouseDown={preventBlur}
            onTouchStart={preventBlur}
            onClick={() => handleKeyClick('\x1b[C')}
            aria-label="Right arrow"
          >
            →
          </button>

          {/* Common shell symbols hard to reach on mobile */}
          <button
            type="button"
            className="mobile-key-btn"
            onMouseDown={preventBlur}
            onTouchStart={preventBlur}
            onClick={() => handleKeyClick('|')}
          >
            |
          </button>
          <button
            type="button"
            className="mobile-key-btn"
            onMouseDown={preventBlur}
            onTouchStart={preventBlur}
            onClick={() => handleKeyClick('~')}
          >
            ~
          </button>
        </div>
      )}
    </div>
  );
};
