import * as React from 'react';
import ReactDOMServer from 'react-dom/server';
import { AuthProvider } from './src/context/AuthContext.ts';
import { ToastProvider } from './src/context/ToastContext.ts';
import { SettingsModal } from './src/components/settings/SettingsModal.ts';

global.fetch = async (url) => {
  const s = String(url);
  console.log('FETCH:', s);
  if (s.includes('/api/settings')) return Response.json({ debugSseConsole: false, securityEnabled: false });
  if (s.includes('/api/auth/me')) return Response.json({ id: 1, username: 'alice', role: 'admin' });
  return Response.json({});
};

setTimeout(async () => {
  const html = ReactDOMServer.renderToString(
    React.createElement(AuthProvider, null,
      React.createElement(ToastProvider, null,
        React.createElement(SettingsModal)
      )
    )
  );
  console.log('HTML LENGTH:', html.length);
  console.log('First 500 chars:', html.substring(0, 500));
  process.exit(0);
}, 700);
