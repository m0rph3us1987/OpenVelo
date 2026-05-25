import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as React from 'react';
import ReactDOMServer from 'react-dom/server';
import { ToastProvider, useToast } from '@/context/ToastContext';
import { Toaster } from '@/components/ui/Toaster';

function TestComponent() {
  const { showToast } = useToast();
  React.useEffect(() => {
    showToast('Hello', 'success');
  }, [showToast]);
  return <div>Test</div>;
}

function ErrorComponent() {
  const { showToast } = useToast();
  React.useEffect(() => {
    showToast('Error!', 'error');
  }, [showToast]);
  return <div>Test</div>;
}

function SuccessApp() {
  return (
    <ToastProvider>
      <TestComponent />
      <Toaster />
    </ToastProvider>
  );
}

function ErrorApp() {
  return (
    <ToastProvider>
      <ErrorComponent />
      <Toaster />
    </ToastProvider>
  );
}

describe.skip('ToastContext', () => {
  it('renders toast via renderToString', async () => {
    const html = await new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve(ReactDOMServer.renderToString(<SuccessApp />));
      }, 600);
    });
    assert.ok(html.includes('Hello'), `Expected "Hello" in renderer output, got: ${html}`);
  });

  it('renders error toast via renderToString', async () => {
    const html = await new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve(ReactDOMServer.renderToString(<ErrorApp />));
      }, 600);
    });
    assert.ok(html.includes('Error!'), `Expected "Error!" in renderer output, got: ${html}`);
  });
});