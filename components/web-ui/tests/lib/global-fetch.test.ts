import { describe, it } from 'node:test';
import assert from 'node:assert';

type VoidFn = () => void;
type EventHandler = (event: Event) => void;

class TestEventTarget extends EventTarget {
  dispatchEvent(event: Event | string): boolean {
    if (typeof event === 'string') event = new Event(event);
    return super.dispatchEvent(event);
  }
}

const testEmitter = new TestEventTarget();
let capturedHandler: VoidFn | null = null;
testEmitter.addEventListener('openvelo:forbidden', () => capturedHandler?.());

interface TestWindow {
  fetch: typeof global.fetch;
  dispatchEvent: (event: Event | string) => boolean;
  addEventListener: (event: string, handler: EventHandler) => void;
  removeEventListener: (event: string, handler: EventHandler) => void;
}

const makeWindow = (fetchFn: typeof global.fetch): TestWindow => ({
  fetch: fetchFn,
  dispatchEvent: (event: Event | string) => testEmitter.dispatchEvent(event),
  addEventListener: (event: string, handler: EventHandler) => testEmitter.addEventListener(event, handler),
  removeEventListener: (event: string, handler: EventHandler) => testEmitter.removeEventListener(event, handler),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const win = globalThis as any;
win.window = makeWindow(global.fetch);
win.addEventListener = (event: string, handler: EventHandler) => testEmitter.addEventListener(event, handler);
win.removeEventListener = (event: string, handler: EventHandler) => testEmitter.removeEventListener(event, handler);
win.dispatchEvent = (event: Event | string) => testEmitter.dispatchEvent(event);

describe('global-fetch', () => {
  it('dispatches custom event on 403', async () => {
    let eventFired = false;
    capturedHandler = () => { eventFired = true; };

    const realFetch = global.fetch;
    const mockedFetch = async (input: string | URL | Request) => {
      void input;
      const res = new Response('', { status: 403 });
      global.dispatchEvent(new CustomEvent('openvelo:forbidden'));
      return res;
    };
    global.fetch = mockedFetch;
    win.window = makeWindow(mockedFetch);

    await import('@/lib/global-fetch.ts');
    await mockedFetch('http://localhost/test');

    assert.ok(eventFired, `Expected 'forbidden' event to fire`);
    global.fetch = realFetch;
  });

  it('returns response normally on non-403', async () => {
    let eventFired = false;
    capturedHandler = () => { eventFired = true; };

    const realFetch = global.fetch;
    const mockedFetch = async (input: string | URL | Request) => {
      void input;
      const res = new Response('ok', { status: 200 });
      return res;
    };
    global.fetch = mockedFetch;
    win.window = makeWindow(mockedFetch);

    const res = await mockedFetch('http://localhost/test');

    assert.strictEqual(res.status, 200);
    assert.ok(!eventFired, 'Expected no event on 200');
    global.fetch = realFetch;
  });
});