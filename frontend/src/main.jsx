import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/atkinson-hyperlegible/400.css'; // police embarquée : plus de dépendance à Google Fonts (hors ligne, vie privée)
import '@fontsource/atkinson-hyperlegible/700.css';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { initToken } from './api.js';
import { isNative } from './platform.js';
import NativeBridge from './NativeBridge.jsx';
import './styles.css';

if (isNative) document.documentElement.classList.add('native');

initToken().finally(() => {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode><BrowserRouter><AuthProvider><NativeBridge /><App /></AuthProvider></BrowserRouter></React.StrictMode>
  );
  if (isNative) {
    import('@capacitor/splash-screen').then(({ SplashScreen }) => SplashScreen.hide()).catch(() => {});
  } else if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
