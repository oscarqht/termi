import type { Terminal } from '@xterm/xterm';

export interface TouchScrollOptions {
  container: HTMLElement;
  term: Terminal;
  onSendInput: (data: string) => void;
}

interface VelocityPoint {
  y: number;
  time: number;
}

/**
 * Attaches a high-performance, inertia-enabled touch scrolling controller
 * to the terminal container.
 *
 * Solves:
 * 1. Scrolling on the left half of the screen having no effect (due to .xterm-screen
 *    stacking above .xterm-viewport without touch-action: none or native overflow).
 * 2. Unresponsive or aborted gestures when swiping too fast.
 * 3. Lack of smooth momentum / deceleration on mobile touch screens.
 * 4. Inability to scroll inside full-screen apps (vim, less, nano, htop) via touch swipe.
 */
export function setupTerminalTouchScroll({
  container,
  term,
  onSendInput,
}: TouchScrollOptions): () => void {
  let touchId: number | null = null;
  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let lastTouchClientX = 0;
  let lastTouchClientY = 0;
  let direction: 'vertical' | 'horizontal' | null = null;
  let hasMoved = false;
  let momentumInterrupted = false;
  let accumulatedDelta = 0;
  let velocityHistory: VelocityPoint[] = [];

  let rafId: number | null = null;
  let currentVelocity = 0; // in px/ms (positive = scroll down / finger moved up)
  let lastFrameTime = 0;

  const FRICTION = 0.95;
  const MIN_VELOCITY = 0.02; // px/ms
  const VELOCITY_WINDOW_MS = 100;
  const DIRECTION_LOCK_THRESHOLD = 6; // px

  function cancelMomentum() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    currentVelocity = 0;
  }

  function getCellHeight(): number {
    try {
      const core = (term as unknown as { _core?: { _renderService?: { dimensions?: { css?: { cell?: { height?: number } } } } } })._core;
      const h = core?._renderService?.dimensions?.css?.cell?.height;
      if (typeof h === 'number' && h > 0) return h;
    } catch {}

    const row = container.querySelector('.xterm-rows > div') as HTMLElement | null;
    if (row && row.offsetHeight > 0) {
      return row.offsetHeight;
    }
    return 17;
  }

  function getCellDimensions(): { width: number; height: number } {
    try {
      const core = (term as unknown as { _core?: { _renderService?: { dimensions?: { css?: { cell?: { width?: number; height?: number } } } } } })._core;
      const w = core?._renderService?.dimensions?.css?.cell?.width;
      const h = core?._renderService?.dimensions?.css?.cell?.height;
      if (typeof w === 'number' && w > 0 && typeof h === 'number' && h > 0) {
        return { width: w, height: h };
      }
    } catch {}

    const h = getCellHeight();
    const w = Math.round(h * 0.55);
    return { width: w > 0 ? w : 9, height: h };
  }

  function isMouseTrackingActive(): boolean {
    if (term.modes.mouseTrackingMode && term.modes.mouseTrackingMode !== 'none') {
      return true;
    }
    const core = (term as unknown as { _core?: { coreMouseService?: { areMouseEventsActive?: boolean } } })._core;
    return !!core?.coreMouseService?.areMouseEventsActive;
  }

  function sendMouseWheel(lines: number) {
    const count = Math.min(Math.abs(lines), 5);
    // In terminal mouse protocol: action 0 = UP (scroll up, finger moving down), 1 = DOWN (scroll down, finger moving up)
    const action = lines > 0 ? 1 : 0;

    const core = (term as unknown as {
      _core?: {
        coreMouseService?: {
          triggerMouseEvent?: (event: any) => boolean;
        };
      };
    })._core;

    const rect = container.getBoundingClientRect();
    const cellDim = getCellDimensions();
    const relX = Math.max(0, lastTouchClientX - rect.left);
    const relY = Math.max(0, lastTouchClientY - rect.top);
    const col = Math.max(0, Math.min(term.cols - 1, Math.floor(relX / cellDim.width)));
    const row = Math.max(0, Math.min(term.rows - 1, Math.floor(relY / cellDim.height)));

    let triggered = false;
    if (core?.coreMouseService?.triggerMouseEvent) {
      for (let i = 0; i < count; i++) {
        const ok = core.coreMouseService.triggerMouseEvent({
          col,
          row,
          x: Math.round(relX),
          y: Math.round(relY),
          button: 4, // CoreMouseButton.WHEEL
          action,
          ctrl: false,
          alt: false,
          shift: false,
        });
        if (ok) triggered = true;
      }
    }

    if (!triggered) {
      // Fallback: send SGR mouse wheel sequence directly (1-based col and row)
      const sgrCode = lines > 0 ? 65 : 64; // 64 = wheel up, 65 = wheel down
      const seq = `\x1b[<${sgrCode};${col + 1};${row + 1}M`;
      onSendInput(seq.repeat(count));
    }
  }

  function scrollBuffer(pixelDelta: number) {
    const cellHeight = getCellHeight();

    // 1. If mouse tracking is active (e.g. Claude CLI / Code, tmux with mouse, vim with mouse)
    if (isMouseTrackingActive()) {
      accumulatedDelta += pixelDelta;
      if (Math.abs(accumulatedDelta) >= cellHeight) {
        const lines = Math.trunc(accumulatedDelta / cellHeight);
        accumulatedDelta -= lines * cellHeight;
        sendMouseWheel(lines);
      }
      return true;
    }

    const isAltBuffer = term.buffer.active.type === 'alternate';

    // 2. Alternate buffer without mouse tracking (e.g. vim, nano, less, man)
    if (isAltBuffer) {
      accumulatedDelta += pixelDelta;
      if (Math.abs(accumulatedDelta) >= cellHeight) {
        const lines = Math.trunc(accumulatedDelta / cellHeight);
        accumulatedDelta -= lines * cellHeight;

        // In alternate buffer, send Up/Down cursor keys
        const core = (term as unknown as { _core?: { coreService?: { decPrivateModes?: { applicationCursorKeys?: boolean } } } })._core;
        const appCursor = !!core?.coreService?.decPrivateModes?.applicationCursorKeys;
        const seq = lines > 0 ? (appCursor ? '\x1bOB' : '\x1b[B') : (appCursor ? '\x1bOA' : '\x1b[A');
        const count = Math.min(Math.abs(lines), 5);
        onSendInput(seq.repeat(count));
      }
      return true;
    }

    // 3. Normal buffer history scrolling
    const atBottom = term.buffer.active.viewportY >= term.buffer.active.baseY;
    const atTop = term.buffer.active.viewportY <= 0;

    if ((pixelDelta > 0 && atBottom) || (pixelDelta < 0 && atTop)) {
      accumulatedDelta = 0;
      return false; // Hit boundary
    }

    accumulatedDelta += pixelDelta;
    const lines = Math.trunc(accumulatedDelta / cellHeight);
    if (lines !== 0) {
      term.scrollLines(lines);
      accumulatedDelta -= lines * cellHeight;

      // Re-check boundary after scrolling
      if (
        (lines > 0 && term.buffer.active.viewportY >= term.buffer.active.baseY) ||
        (lines < 0 && term.buffer.active.viewportY <= 0)
      ) {
        return false;
      }
    }
    return true;
  }

  function startMomentum(initialVelocity: number) {
    cancelMomentum();
    currentVelocity = initialVelocity;
    lastFrameTime = performance.now();

    function step(now: number) {
      const dt = Math.min(now - lastFrameTime, 64);
      lastFrameTime = now;

      if (dt > 0) {
        // Exponential friction decay based on frame time
        currentVelocity *= Math.pow(FRICTION, dt / 16.67);
      }

      if (Math.abs(currentVelocity) < MIN_VELOCITY) {
        cancelMomentum();
        return;
      }

      const framePixelDelta = currentVelocity * dt;
      const canContinue = scrollBuffer(framePixelDelta);

      if (!canContinue) {
        cancelMomentum();
        return;
      }

      rafId = requestAnimationFrame(step);
    }

    rafId = requestAnimationFrame(step);
  }

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) {
      // Multiple touches (e.g. pinch or multi-finger gesture), cancel any momentum
      cancelMomentum();
      touchId = null;
      return;
    }

    const touch = e.touches[0];
    touchId = touch.identifier;
    startX = touch.clientX;
    startY = touch.clientY;
    lastY = touch.clientY;
    lastTouchClientX = touch.clientX;
    lastTouchClientY = touch.clientY;
    direction = null;
    hasMoved = false;
    accumulatedDelta = 0;

    // If momentum was currently running, a tap stops it immediately
    if (rafId !== null) {
      cancelMomentum();
      momentumInterrupted = true;
    } else {
      momentumInterrupted = false;
    }

    const now = performance.now();
    velocityHistory = [{ y: touch.clientY, time: now }];
  }

  function handleTouchMove(e: TouchEvent) {
    if (touchId === null) return;

    let touch: Touch | null = null;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId) {
        touch = e.changedTouches[i];
        break;
      }
    }
    if (!touch) return;

    const currentX = touch.clientX;
    const currentY = touch.clientY;
    lastTouchClientX = currentX;
    lastTouchClientY = currentY;
    const dx = currentX - startX;
    const dy = currentY - startY;

    if (direction === null) {
      const distance = Math.hypot(dx, dy);
      if (distance >= DIRECTION_LOCK_THRESHOLD) {
        if (Math.abs(dy) >= Math.abs(dx)) {
          direction = 'vertical';
        } else {
          direction = 'horizontal';
        }
      }
    }

    if (direction === 'vertical') {
      // Prevent browser native scrolling, bouncing, and pull-to-refresh
      if (e.cancelable) {
        e.preventDefault();
      }
      hasMoved = true;

      const now = performance.now();
      const pixelDelta = lastY - currentY; // Moving finger up -> scroll down
      lastY = currentY;

      velocityHistory.push({ y: currentY, time: now });
      const cutoff = now - VELOCITY_WINDOW_MS;
      while (velocityHistory.length > 1 && velocityHistory[0].time < cutoff) {
        velocityHistory.shift();
      }

      scrollBuffer(pixelDelta);
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    if (touchId === null) return;

    let touch: Touch | null = null;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId) {
        touch = e.changedTouches[i];
        break;
      }
    }
    if (!touch) return;

    touchId = null;

    if (!hasMoved) {
      // Tap without movement
      if (!momentumInterrupted) {
        // Genuine idle tap -> focus the terminal
        term.focus();
      }
      return;
    }

    if (direction === 'vertical') {
      const now = performance.now();
      const cutoff = now - VELOCITY_WINDOW_MS;
      const recent = velocityHistory.filter((p) => p.time >= cutoff);

      if (recent.length >= 2) {
        const first = recent[0];
        const last = recent[recent.length - 1];
        const timeDelta = last.time - first.time;

        if (timeDelta > 10) {
          // Positive velocity: finger moving up -> scroll down
          let velocity = (first.y - last.y) / timeDelta;

          // Ignore tiny release velocities
          if (Math.abs(velocity) > 0.15) {
            // Cap max velocity to prevent uncontrollably fast spinning
            const maxVelocity = 4.0;
            velocity = Math.sign(velocity) * Math.min(Math.abs(velocity), maxVelocity);
            startMomentum(velocity);
          }
        }
      }
    }
  }

  function handleTouchCancel() {
    touchId = null;
    cancelMomentum();
    direction = null;
    hasMoved = false;
  }

  // Attach touch listeners to the container element with { passive: false }
  // to ensure e.preventDefault() reliably locks scrolling and stops native interference.
  container.addEventListener('touchstart', handleTouchStart, { passive: false });
  container.addEventListener('touchmove', handleTouchMove, { passive: false });
  container.addEventListener('touchend', handleTouchEnd, { passive: false });
  container.addEventListener('touchcancel', handleTouchCancel, { passive: false });

  return () => {
    cancelMomentum();
    container.removeEventListener('touchstart', handleTouchStart);
    container.removeEventListener('touchmove', handleTouchMove);
    container.removeEventListener('touchend', handleTouchEnd);
    container.removeEventListener('touchcancel', handleTouchCancel);
  };
}
