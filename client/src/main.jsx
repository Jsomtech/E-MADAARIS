import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './i18n/index.js';
import './styles/app.css';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';

// After a dev-server restart or a new deployment the hashed chunks in an open tab
// no longer exist; reload once instead of leaving a blank dashboard.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const last = Number(sessionStorage.getItem('emadaaris.chunkReload') || 0);
  if (Date.now() - last < 10_000) return;
  sessionStorage.setItem('emadaaris.chunkReload', String(Date.now()));
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <App />
        <ToastContainer position="top-right" autoClose={2600} newestOnTop theme="light" />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
