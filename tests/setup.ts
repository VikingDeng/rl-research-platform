import { afterEach, beforeEach, vi } from 'vitest';

// React 18/19 testing hint to avoid act-environment warnings in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const createMemoryStorage = () => {
  const bucket = new Map<string, string>();
  return {
    getItem: (key: string) => (bucket.has(key) ? bucket.get(key)! : null),
    setItem: (key: string, value: string) => {
      bucket.set(String(key), String(value));
    },
    removeItem: (key: string) => {
      bucket.delete(String(key));
    },
    clear: () => {
      bucket.clear();
    },
  };
};

const ensureLocalStorage = () => {
  if (typeof window === 'undefined') return;
  const localStorageLike = (window as unknown as { localStorage?: Record<string, unknown> }).localStorage;
  if (!localStorageLike || typeof localStorageLike.getItem !== 'function' || typeof localStorageLike.clear !== 'function') {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      writable: true,
      value: createMemoryStorage(),
    });
  }
};

ensureLocalStorage();

beforeEach(() => {
  if (typeof window !== 'undefined') {
    ensureLocalStorage();
    if (typeof window.localStorage?.clear === 'function') {
      (window.localStorage as { clear: () => void }).clear();
    }
  }
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
