import { useSyncExternalStore, useEffect } from 'react';

const subscribers = new Set<() => void>();

function syncDOMClasses(isDark: boolean) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (isDark) {
    root.classList.add('dark');
    root.classList.remove('light');
    root.setAttribute('data-theme', 'dark');
    root.style.colorScheme = 'dark';
    if (document.body) {
      document.body.classList.add('dark');
      document.body.classList.remove('light');
      document.body.setAttribute('data-theme', 'dark');
      document.body.style.colorScheme = 'dark';
    }
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
    root.setAttribute('data-theme', 'light');
    root.style.colorScheme = 'light';
    if (document.body) {
      document.body.classList.remove('dark');
      document.body.classList.add('light');
      document.body.setAttribute('data-theme', 'light');
      document.body.style.colorScheme = 'light';
    }
  }
}

function getSystemDarkPreference(): boolean {
  if (typeof window === 'undefined') return true;
  if (window.matchMedia) {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {}
  }
  return true;
}

let currentIsDark = typeof window !== 'undefined' ? getSystemDarkPreference() : true;
let isInitialized = false;

if (typeof window !== 'undefined') {
  syncDOMClasses(currentIsDark);
}

function notifySubscribers() {
  const nextIsDark = getSystemDarkPreference();
  currentIsDark = nextIsDark;
  syncDOMClasses(nextIsDark);
  subscribers.forEach((callback) => {
    try {
      callback();
    } catch (err) {
      console.error('Error in theme listener callback:', err);
    }
  });
}

function initGlobalListeners() {
  if (isInitialized || typeof window === 'undefined') return;
  isInitialized = true;

  if (window.matchMedia) {
    try {
      const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
      const handleMqChange = () => {
        notifySubscribers();
      };
      if (darkMq.addEventListener) {
        darkMq.addEventListener('change', handleMqChange);
      } else if ('addListener' in darkMq) {
        (darkMq as any).addListener(handleMqChange);
      }
    } catch (e) {
      console.warn('[useSystemTheme] Could not bind matchMedia listener:', e);
    }
  }
}

function getSnapshot(): boolean {
  return currentIsDark;
}

function getServerSnapshot(): boolean {
  return true;
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  initGlobalListeners();
  subscribers.add(callback);

  const latest = getSystemDarkPreference();
  if (latest !== currentIsDark) {
    currentIsDark = latest;
    syncDOMClasses(latest);
  }

  return () => {
    subscribers.delete(callback);
  };
}

export function useSystemTheme(): { isDark: boolean; theme: 'dark' | 'light' } {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    syncDOMClasses(isDark);
  }, [isDark]);

  return {
    isDark,
    theme: isDark ? 'dark' : 'light',
  };
}
