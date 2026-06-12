import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Self-hosted fonts (no Google CDN — DSGVO). Inter (static) stays the app
// default and matches fontFamily.sans=['Inter',…]; the variable
// Playfair/Caveat/JetBrains families are used only in the cookbook views.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource-variable/playfair-display';
import '@fontsource-variable/playfair-display/wght-italic.css';
import '@fontsource-variable/caveat';
import '@fontsource-variable/jetbrains-mono';
import App from './App';
import './index.css';
import { setupAutoFlush, setToaster } from './offline/syncQueue';
import { toast } from './components/Toast';

// Wire the offline queue's toasts into the live toast host before any flushes.
setToaster({ success: toast.success, error: toast.error, info: toast.info });
setupAutoFlush();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
