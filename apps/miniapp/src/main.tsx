import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { App } from './App';

const w = window as unknown as {
  Telegram?: {
    WebApp?: {
      ready?: () => void;
      expand?: () => void;
    };
  };
};

try {
  w.Telegram?.WebApp?.ready?.();
  w.Telegram?.WebApp?.expand?.();
} catch {
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
