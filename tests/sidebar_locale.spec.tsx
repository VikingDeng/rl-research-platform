import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { I18nProvider } from '../services/i18n';

const findButtonByText = (container: HTMLElement, text: string): HTMLButtonElement | null => {
  const buttons = Array.from(container.querySelectorAll('button'));
  const matched = buttons.find(item => item.textContent?.trim() === text);
  return matched instanceof HTMLButtonElement ? matched : null;
};

describe('sidebar locale toggle', () => {
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

  it('switches language via sidebar 中/EN buttons', () => {
    window.localStorage.setItem('ui_language', 'zh-CN');

    act(() => {
      root?.render(
        <MemoryRouter>
          <I18nProvider>
            <Sidebar />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain('工作区');
    const enBtn = findButtonByText(container, 'EN');
    expect(enBtn).not.toBeNull();

    act(() => {
      enBtn?.click();
    });

    expect(window.localStorage.getItem('ui_language')).toBe('en-US');
    expect(document.documentElement.lang).toBe('en-US');
    expect(container.textContent).toContain('Workspace');

    const zhBtn = findButtonByText(container, '中');
    expect(zhBtn).not.toBeNull();
    act(() => {
      zhBtn?.click();
    });

    expect(window.localStorage.getItem('ui_language')).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(container.textContent).toContain('工作区');
  });
});
