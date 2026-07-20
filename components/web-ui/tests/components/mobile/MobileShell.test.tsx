import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Window } from 'happy-dom';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ToastProvider } from '@/context/ToastContext';
import { AuthProvider } from '@/context/AuthContext';
import { MobileShell } from '@/components/mobile/MobileShell';

function setupDOM() {
  const window = new Window({ url: 'https://localhost' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).window = window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).document = window.document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).navigator = window.navigator;
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    },
    writable: true,
  });
  // happy-dom does not implement history.pushState/popstate by default
  if (typeof window.history.pushState !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.history as any).pushState = (_state: unknown, _title: string, _url?: string) => {};
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(window as any).matchMedia) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    });
  }
}

function TestWrapper({ children }: { children: React.ReactElement }) {
  return React.createElement(BrowserRouter, null,
    React.createElement(ThemeProvider, null,
      React.createElement(ToastProvider, null,
        React.createElement(AuthProvider, null,
          children
        )
      )
    )
  );
}

async function flush() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

describe('MobileShell', () => {
  let origFetch: typeof global.fetch;
  let origBodyOverflow: string;

  beforeEach(() => {
    setupDOM();
    origFetch = global.fetch;
    origBodyOverflow = document.body.style.overflow;
  });

  afterEach(() => {
    global.fetch = origFetch;
    document.body.style.overflow = origBodyOverflow;
    cleanup();
  });

  it('renders the hamburger button with aria-label "Open navigation" and tap-target class', async () => {
    global.fetch = async () => Response.json({}) as Response;
    const { container } = render(
      TestWrapper({ children: React.createElement(MobileShell as any, {
        open: false,
        onOpenChange: () => {},
        title: 'Test',
        children: React.createElement('div', null, 'body'),
      }) })
    );
    await flush();
    const btn = container.querySelector('button[aria-label="Open navigation"]');
    assert.ok(btn, 'hamburger button must be rendered');
    assert.ok((btn as HTMLElement).className.includes('tap-target'), 'must use tap-target utility');
    // No hover:* classes anywhere in the shell
    assert.ok(!container.innerHTML.includes('hover:'), 'shell must not contain hover:* classes');
  });

  it('clicking the hamburger button calls onOpenChange(true) and locks body scroll', async () => {
    let lastOpen = false;
    const onOpenChange = (v: boolean) => {
      lastOpen = v;
    };
    global.fetch = async () => Response.json({}) as Response;
    const Harness = () => {
      const [open, setOpen] = React.useState(false);
      const handler = (v: boolean) => {
        lastOpen = v;
        setOpen(v);
      };
      return React.createElement(MobileShell as any, {
        open,
        onOpenChange: handler,
        title: 'Test',
        children: React.createElement('div', null, 'body'),
      });
    };
    const { container } = render(
      TestWrapper({ children: React.createElement(Harness) })
    );
    await flush();
    const hamburger = container.querySelector('button[aria-label="Open navigation"]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(hamburger);
    });
    assert.strictEqual(lastOpen, true, 'onOpenChange must be called with true');
    assert.strictEqual(document.body.style.overflow, 'hidden', 'body scroll must be locked');
  });

  it('Escape key while open calls onOpenChange(false) and unlocks body scroll', async () => {
    let lastOpen = true;
    const Harness = () => {
      const [open, setOpen] = React.useState(true);
      const handler = (v: boolean) => {
        lastOpen = v;
        setOpen(v);
      };
      return React.createElement(MobileShell as any, {
        open,
        onOpenChange: handler,
        title: 'Test',
        children: React.createElement('div', null, 'body'),
      });
    };
    global.fetch = async () => Response.json({}) as Response;
    render(
      TestWrapper({ children: React.createElement(Harness) })
    );
    await flush();
    assert.strictEqual(document.body.style.overflow, 'hidden', 'body scroll must be locked while open');
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    assert.strictEqual(lastOpen, false, 'onOpenChange must be called with false on Escape');
  });

  it('scrim has aria-label "Close menu" and clicking it closes the drawer', async () => {
    let lastOpen = true;
    const Harness = () => {
      const [open, setOpen] = React.useState(true);
      const handler = (v: boolean) => {
        lastOpen = v;
        setOpen(v);
      };
      return React.createElement(MobileShell as any, {
        open,
        onOpenChange: handler,
        title: 'Test',
        children: React.createElement('div', null, 'body'),
      });
    };
    global.fetch = async () => Response.json({}) as Response;
    const { container } = render(
      TestWrapper({ children: React.createElement(Harness) })
    );
    await flush();
    const scrim = container.querySelector('button[aria-label="Close menu"]') as HTMLButtonElement;
    assert.ok(scrim, 'scrim must render while drawer is open');
    await act(async () => {
      fireEvent.click(scrim);
    });
    assert.strictEqual(lastOpen, false, 'clicking the scrim must close the drawer');
  });

  it('renders the title as a tappable button (default) with aria-label "Go to projects"', async () => {
    global.fetch = async () => Response.json({}) as Response;
    const { container } = render(
      TestWrapper({ children: React.createElement(MobileShell as any, {
        open: false,
        onOpenChange: () => {},
        title: 'Project Foo',
        children: React.createElement('div', null, 'body'),
      }) })
    );
    await flush();
    const titleBtn = container.querySelector('button[aria-label="Go to projects"]') as HTMLButtonElement;
    assert.ok(titleBtn, 'title must be rendered as a button by default');
    assert.strictEqual(titleBtn.textContent, 'Project Foo', 'title button must display the title text');
    assert.ok(titleBtn.className.includes('tap-target'), 'title button must use tap-target');
  });

  it('clicking the title (default handler) navigates to /', async () => {
    let observedPath: string | null = null;
    function PathSpy() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      observedPath = (window as any).location?.pathname ?? null;
      return null;
    }
    global.fetch = async () => Response.json({}) as Response;
    const { container } = render(
      TestWrapper({ children: React.createElement(React.Fragment, null,
        React.createElement(PathSpy),
        React.createElement(MobileShell as any, {
          open: false,
          onOpenChange: () => {},
          title: 'Project Foo',
          children: React.createElement('div', null, 'body'),
        })
      ) })
    );
    await flush();
    const titleBtn = container.querySelector('button[aria-label="Go to projects"]') as HTMLButtonElement;
    assert.ok(titleBtn, 'title button must render');
    await act(async () => {
      fireEvent.click(titleBtn);
    });
    await flush();
    assert.strictEqual(observedPath, '/', 'clicking the title must navigate to /');
  });

  it('explicit onTitleClick=null renders the title as a plain <h1> (no button)', async () => {
    global.fetch = async () => Response.json({}) as Response;
    const { container } = render(
      TestWrapper({ children: React.createElement(MobileShell as any, {
        open: false,
        onOpenChange: () => {},
        title: 'Projects',
        onTitleClick: null,
        children: React.createElement('div', null, 'body'),
      }) })
    );
    await flush();
    const titleBtn = container.querySelector('button[aria-label="Go to projects"]');
    assert.strictEqual(titleBtn, null, 'title button must not render when onTitleClick is null');
    const h1 = container.querySelector('h1');
    assert.ok(h1, '<h1> must render');
    assert.strictEqual(h1?.textContent, 'Projects', '<h1> must show the title');
  });

  it('custom onTitleClick is invoked when the title is tapped', async () => {
    let calls = 0;
    global.fetch = async () => Response.json({}) as Response;
    const { container } = render(
      TestWrapper({ children: React.createElement(MobileShell as any, {
        open: false,
        onOpenChange: () => {},
        title: 'Anything',
        onTitleClick: () => { calls++; },
        children: React.createElement('div', null, 'body'),
      }) })
    );
    await flush();
    const titleBtn = container.querySelector('button[aria-label="Go to projects"]') as HTMLButtonElement;
    assert.ok(titleBtn, 'title button must render with custom handler');
    await act(async () => {
      fireEvent.click(titleBtn);
    });
    assert.strictEqual(calls, 1, 'custom onTitleClick must be called once');
  });
});