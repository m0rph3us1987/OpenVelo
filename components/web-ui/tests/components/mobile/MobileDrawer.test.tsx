import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { Window } from 'happy-dom';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ToastProvider } from '@/context/ToastContext';
import { AuthProvider } from '@/context/AuthContext';
import { MobileDrawer } from '@/components/mobile/MobileDrawer';

function setupDOM() {
  const window = new Window({ url: 'https://localhost/projects/3' });
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

describe('MobileDrawer', () => {
  let origFetch: typeof global.fetch;

  beforeEach(() => {
    setupDOM();
    origFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
    cleanup();
  });

  it('does NOT render a top-level projects list (projects are on the landing page)', async () => {
    global.fetch = async (url: unknown) => {
      const u = String(url);
      if (u === '/api/auth/me') return Response.json({}) as Response;
      if (u === '/api/settings') return Response.json({}) as Response;
      if (u === '/api/themes') return Response.json([]) as Response;
      if (u === '/api/projects') {
        return Response.json([
          { id: 1, name: 'Alpha' },
          { id: 2, name: 'Beta' },
        ]) as Response;
      }
      return Response.json({}) as Response;
    };
    const { container } = render(
      TestWrapper({ children: React.createElement(MobileDrawer as any, {
        open: true,
        onClose: () => {},
      }) })
    );
    await flush();
    await flush();
    assert.ok(
      !container.textContent?.includes('Alpha'),
      'drawer must NOT list projects fetched from /api/projects'
    );
    assert.ok(
      !container.textContent?.includes('Beta'),
      'drawer must NOT list projects fetched from /api/projects'
    );
  });

  it('project Settings nav row opens project settings and closes the drawer (does not navigate)', async () => {
    global.fetch = async (url: unknown) => {
      const u = String(url);
      if (u === '/api/auth/me') return Response.json({}) as Response;
      if (u === '/api/settings') return Response.json({}) as Response;
      if (u === '/api/themes') return Response.json([]) as Response;
      if (u === '/api/projects') return Response.json([]) as Response;
      return Response.json({}) as Response;
    };
    let observedPath: string | null = null;
    function PathSpy() {
      const loc = useLocation();
      observedPath = loc.pathname;
      return null;
    }
    let openSettingsCount = 0;
    let closeCount = 0;
    const { container } = render(
      React.createElement(BrowserRouter, null,
        React.createElement(ThemeProvider, null,
          React.createElement(ToastProvider, null,
            React.createElement(AuthProvider, null,
              React.createElement(React.Fragment, null,
                React.createElement(PathSpy),
                React.createElement(MobileDrawer as any, {
                  open: true,
                  onClose: () => { closeCount++; },
                  projectId: 3,
                  onOpenProjectSettings: () => { openSettingsCount++; },
                })
              )
            )
          )
        )
      )
    );
    await flush();
    // The project navigation Settings row is rendered before the global nav Settings row.
    const projectNav = container.querySelector('nav[aria-label="Project navigation"]') as HTMLElement;
    assert.ok(projectNav, 'project navigation must be present');
    const settingsBtn = Array.from(projectNav.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Settings'
    ) as HTMLButtonElement;
    assert.ok(settingsBtn, 'project Settings nav row must be present');
    fireEvent.click(settingsBtn);
    assert.strictEqual(openSettingsCount, 1, 'project Settings row must call onOpenProjectSettings');
    assert.strictEqual(closeCount, 1, 'project Settings row must close the drawer');
    assert.notStrictEqual(observedPath, '/settings', 'project Settings row must not navigate to global /settings');
  });

  it('global Settings nav row invokes onOpenSettings and does not navigate', async () => {
    global.fetch = async (url: unknown) => {
      const u = String(url);
      if (u === '/api/auth/me') return Response.json({}) as Response;
      if (u === '/api/settings') return Response.json({}) as Response;
      if (u === '/api/themes') return Response.json([]) as Response;
      if (u === '/api/projects') return Response.json([]) as Response;
      return Response.json({}) as Response;
    };
    let observedPath: string | null = null;
    function PathSpy() {
      const loc = useLocation();
      observedPath = loc.pathname;
      return null;
    }
    let openSettingsCount = 0;
    let closeCount = 0;
    const { container } = render(
      React.createElement(BrowserRouter, null,
        React.createElement(ThemeProvider, null,
          React.createElement(ToastProvider, null,
            React.createElement(AuthProvider, null,
              React.createElement(React.Fragment, null,
                React.createElement(PathSpy),
                React.createElement(MobileDrawer as any, {
                  open: true,
                  onClose: () => { closeCount++; },
                  onOpenSettings: () => { openSettingsCount++; },
                })
              )
            )
          )
        )
      )
    );
    await flush();
    const globalNav = container.querySelector('nav[aria-label="Global navigation"]') as HTMLElement;
    assert.ok(globalNav, 'global navigation must be present');
    const settingsBtn = Array.from(globalNav.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Settings'
    ) as HTMLButtonElement;
    assert.ok(settingsBtn, 'global Settings nav row must be present');
    fireEvent.click(settingsBtn);
    assert.strictEqual(openSettingsCount, 1, 'global Settings row must call onOpenSettings');
    assert.strictEqual(closeCount, 1, 'global Settings row must close the drawer');
    assert.notStrictEqual(observedPath, '/settings', 'global Settings row must not navigate');
    assert.strictEqual(observedPath, '/projects/3', 'global Settings row must keep the current route');
  });

  it('every interactive control has the tap-target class (≥44×44 design intent)', async () => {
    global.fetch = async (url: unknown) => {
      const u = String(url);
      if (u === '/api/auth/me') return Response.json({}) as Response;
      if (u === '/api/settings') return Response.json({}) as Response;
      if (u === '/api/themes') return Response.json([]) as Response;
      if (u === '/api/projects') {
        return Response.json([{ id: 1, name: 'Alpha' }]) as Response;
      }
      return Response.json({}) as Response;
    };
    const { container } = render(
      TestWrapper({ children: React.createElement(MobileDrawer as any, {
        open: true,
        onClose: () => {},
        projectId: 3,
      }) })
    );
    await flush();
    await flush();
    const buttons = Array.from(container.querySelectorAll('button'));
    assert.ok(buttons.length >= 3, 'should render at least close + 1 project + 3 nav rows');
    for (const b of buttons) {
      assert.ok(
        (b as HTMLElement).className.includes('tap-target'),
        `button "${b.textContent?.trim().slice(0, 30)}" must have tap-target class`
      );
    }
  });

  it('focus-trap: Tab on the last focusable wraps to the first', async () => {
    global.fetch = async (url: unknown) => {
      const u = String(url);
      if (u === '/api/auth/me') return Response.json({}) as Response;
      if (u === '/api/settings') return Response.json({}) as Response;
      if (u === '/api/themes') return Response.json([]) as Response;
      if (u === '/api/projects') return Response.json([]) as Response;
      return Response.json({}) as Response;
    };
    const { container } = render(
      TestWrapper({ children: React.createElement(MobileDrawer as any, {
        open: true,
        onClose: () => {},
        projectId: 3,
      }) })
    );
    await flush();
    const aside = container.querySelector('aside[aria-label="Side navigation"]') as HTMLElement;
    assert.ok(aside, 'drawer must render');
    const focusables = Array.from(aside.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
    assert.ok(focusables.length >= 2, 'drawer must have at least two focusable elements for the trap to be observable');
    const last = focusables[focusables.length - 1];
    const first = focusables[0];
    last.focus();
    assert.strictEqual(document.activeElement, last);
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Tab' });
    });
    assert.strictEqual(document.activeElement, first, 'Tab from the last focusable must wrap to the first');
  });

  it('focus-trap: Shift+Tab on the first focusable wraps to the last', async () => {
    global.fetch = async (url: unknown) => {
      const u = String(url);
      if (u === '/api/auth/me') return Response.json({}) as Response;
      if (u === '/api/settings') return Response.json({}) as Response;
      if (u === '/api/themes') return Response.json([]) as Response;
      if (u === '/api/projects') return Response.json([]) as Response;
      return Response.json({}) as Response;
    };
    const { container } = render(
      TestWrapper({ children: React.createElement(MobileDrawer as any, {
        open: true,
        onClose: () => {},
        projectId: 3,
      }) })
    );
    await flush();
    const aside = container.querySelector('aside[aria-label="Side navigation"]') as HTMLElement;
    const focusables = Array.from(aside.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first.focus();
    assert.strictEqual(document.activeElement, first);
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    });
    assert.strictEqual(document.activeElement, last, 'Shift+Tab from the first focusable must wrap to the last');
  });

  it('focus is restored to the triggerRef element when the drawer closes', async () => {
    global.fetch = async (url: unknown) => {
      const u = String(url);
      if (u === '/api/auth/me') return Response.json({}) as Response;
      if (u === '/api/settings') return Response.json({}) as Response;
      if (u === '/api/themes') return Response.json([]) as Response;
      if (u === '/api/projects') return Response.json([]) as Response;
      return Response.json({}) as Response;
    };
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.textContent = 'hamburger';
    document.body.appendChild(trigger);
    const triggerRef = { current: trigger } as React.MutableRefObject<HTMLButtonElement | null>;

    let isOpen = true;
    const Harness = () => {
      const [open, setOpen] = React.useState(true);
      isOpen = open;
      return React.createElement(MobileDrawer as any, {
        open,
        onClose: () => setOpen(false),
        triggerRef,
      });
    };

    render(TestWrapper({ children: React.createElement(Harness) }));
    await flush();
    // Simulate the shell closing the drawer: the parent flips `open` to false.
    await act(async () => {
      isOpen = false;
    });
    // Re-render with open=false by mutating via the parent's setOpen closure
    // through a click on the drawer's close button instead:
    const closeBtn = document.querySelector('button[aria-label="Close menu"]') as HTMLButtonElement;
    assert.ok(closeBtn, 'drawer close button must render');
    await act(async () => {
      fireEvent.click(closeBtn);
    });
    await flush();
    assert.strictEqual(isOpen, false, 'close button must flip the drawer to closed');
    assert.strictEqual(document.activeElement, trigger, 'focus must be restored to the triggerRef button on close');
    document.body.removeChild(trigger);
  });

  it('renders Change Password and Log out rows when isSecurityEnabled && user', async () => {
    global.fetch = async (url: unknown) => {
      const u = String(url);
      if (u === '/api/auth/me') return Response.json({ user: { id: 1, username: 'alice', role: 'admin' } }) as Response;
      if (u === '/api/settings') return Response.json({ securityEnabled: true }) as Response;
      if (u === '/api/themes') return Response.json([]) as Response;
      if (u === '/api/projects') return Response.json([]) as Response;
      return Response.json({}) as Response;
    };
    const { container } = render(
      TestWrapper({ children: React.createElement(MobileDrawer as any, {
        open: true,
        onClose: () => {},
      }) })
    );
    await flush();
    await flush();
    assert.ok(container.textContent?.includes('Change Password'), 'Change Password row must render');
    assert.ok(container.textContent?.includes('Log out'), 'Log out row must render');
  });

  it('does NOT render auth menu rows when isSecurityEnabled is false', async () => {
    global.fetch = async (url: unknown) => {
      const u = String(url);
      if (u === '/api/auth/me') return Response.json({}) as Response;
      if (u === '/api/settings') return Response.json({}) as Response;
      if (u === '/api/themes') return Response.json([]) as Response;
      if (u === '/api/projects') return Response.json([]) as Response;
      return Response.json({}) as Response;
    };
    const { container } = render(
      TestWrapper({ children: React.createElement(MobileDrawer as any, {
        open: true,
        onClose: () => {},
      }) })
    );
    await flush();
    await flush();
    assert.ok(!container.textContent?.includes('Log out'), 'Log out row must not render when security is disabled');
  });

  it('swipe-left (touchstart -> touchmove -> touchend with deltaX < -50) calls onClose', async () => {
    global.fetch = async (url: unknown) => {
      const u = String(url);
      if (u === '/api/auth/me') return Response.json({}) as Response;
      if (u === '/api/settings') return Response.json({}) as Response;
      if (u === '/api/themes') return Response.json([]) as Response;
      if (u === '/api/projects') return Response.json([]) as Response;
      return Response.json({}) as Response;
    };
    let closeCount = 0;
    const { container } = render(
      TestWrapper({ children: React.createElement(MobileDrawer as any, {
        open: true,
        onClose: () => { closeCount++; },
      }) })
    );
    await flush();
    const aside = container.querySelector('aside[aria-label="Side navigation"]') as HTMLElement;
    assert.ok(aside, 'drawer aside must be rendered while open');

    await act(async () => {
      fireEvent.touchStart(aside, { touches: [{ clientX: 200, clientY: 100 }] });
      fireEvent.touchMove(aside, { touches: [{ clientX: 120, clientY: 100 }] });
      fireEvent.touchEnd(aside, { touches: [] });
    });
    assert.strictEqual(closeCount, 1, 'onClose must be called once on a left swipe > 50 px');

    await act(async () => {
      fireEvent.touchStart(aside, { touches: [{ clientX: 100, clientY: 100 }] });
      fireEvent.touchMove(aside, { touches: [{ clientX: 110, clientY: 100 }] });
      fireEvent.touchEnd(aside, { touches: [] });
    });
    assert.strictEqual(closeCount, 1, 'onClose must not be called for an in-place or right swipe');
  });
});
