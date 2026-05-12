import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
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
