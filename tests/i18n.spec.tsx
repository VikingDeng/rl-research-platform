import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { I18nProvider, useI18n } from '../services/i18n';

const Probe: React.FC = () => {
  const { locale, setLocale, t, tx } = useI18n();
  return (
    <div>
      <div data-testid="locale">{locale}</div>
      <div data-testid="docs-title">{t('settings.docs.totTitle', 'fallback')}</div>
      <div data-testid="dual">{tx('中文', 'English')}</div>
      <div data-testid="missing">{t('missing.message.key', 'fallback-text')}</div>
      <button data-testid="switch-en" type="button" onClick={() => setLocale('en-US')}>
        EN
      </button>
      <button data-testid="switch-zh" type="button" onClick={() => setLocale('zh-CN')}>
        ZH
      </button>
    </div>
  );
};

const byTestId = (container: HTMLElement, testId: string) =>
  container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;

describe('i18n provider', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container.remove();
  });

  it('uses saved locale and syncs html lang/body dataset', () => {
    window.localStorage.setItem('ui_language', 'zh-CN');
    act(() => {
      root?.render(
        <I18nProvider>
          <Probe />
        </I18nProvider>,
      );
    });
    expect(byTestId(container, 'locale')?.textContent).toBe('zh-CN');
    expect(byTestId(container, 'docs-title')?.textContent).toContain('思维树');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.body.dataset.locale).toBe('zh-CN');
  });

  it('switches language immediately and keeps fallback behavior', () => {
    window.localStorage.setItem('ui_language', 'zh-CN');
    act(() => {
      root?.render(
        <I18nProvider>
          <Probe />
        </I18nProvider>,
      );
    });

    const switchEn = byTestId(container, 'switch-en') as HTMLButtonElement;
    act(() => {
      switchEn.click();
    });

    expect(byTestId(container, 'locale')?.textContent).toBe('en-US');
    expect(byTestId(container, 'docs-title')?.textContent).toContain('Tree of Thought');
    expect(byTestId(container, 'dual')?.textContent).toBe('English');
    expect(byTestId(container, 'missing')?.textContent).toBe('fallback-text');
    expect(window.localStorage.getItem('ui_language')).toBe('en-US');
    expect(document.documentElement.lang).toBe('en-US');
    expect(document.body.dataset.locale).toBe('en-US');
  });
});
