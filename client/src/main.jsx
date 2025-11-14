import 'regenerator-runtime/runtime';
import { createRoot } from 'react-dom/client';
import './locales/i18n';
import App from './App';
import './style.css';
import './mobile.css';
import { ApiErrorBoundaryProvider } from './hooks/ApiErrorBoundaryContext';
import 'katex/dist/katex.min.css';
import 'katex/dist/contrib/copy-tex.js';

/* -------------------------------------------
   Função para atualizar favicons dinamicamente
-------------------------------------------- */
function updateAppIcons() {
  const configs = [
    {
      selector: "link[rel='shortcut icon']",
      env: import.meta.env.VITE_FAVICON_MAIN,
    },
    {
      selector: "link[rel='icon'][sizes='32x32']",
      env: import.meta.env.VITE_FAVICON_32,
    },
    {
      selector: "link[rel='icon'][sizes='16x16']",
      env: import.meta.env.VITE_FAVICON_16,
    },
    {
      selector: "link[rel='apple-touch-icon']",
      env: import.meta.env.VITE_APPLE_TOUCH_ICON_180,
    },
  ];

  configs.forEach(({ selector, env }) => {
    if (!env) return; // Sem ENV, usa o fallback original do index.html
    const link = document.querySelector(selector);
    if (link) link.setAttribute("href", env);
  });
}

updateAppIcons();

const container = document.getElementById('root');
const root = createRoot(container);

root.render(
  <ApiErrorBoundaryProvider>
    <App />
  </ApiErrorBoundaryProvider>,
);
