import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initAnalytics } from './analytics';
initAnalytics();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
