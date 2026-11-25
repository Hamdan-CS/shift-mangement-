import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import App from './App.tsx';
import './index.css';
import { seedCookieryDemo } from './services/demoSeed';
import { demoAuth } from './integrations/supabase/client';
import { COOKIERY_DEMO } from './services/demo';

// marketing demo only (dev): fill the browser's demo stores before the app reads them
if (demoAuth && COOKIERY_DEMO) seedCookieryDemo();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
