import React from 'react';
import { createRoot } from 'react-dom/client';
import './globals.css';
import { AuthGate } from './components/AuthGate';
import { ConfirmProvider } from './components/ConfirmDialog';
import { App } from './App';

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <ConfirmProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </ConfirmProvider>
  </React.StrictMode>,
);
