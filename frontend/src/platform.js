import { Capacitor } from '@capacitor/core';

// true dans l'application Android/iOS (Capacitor), false dans le navigateur
export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'

// Web : chemins relatifs (même origine que le backend). Application : URL absolue du backend (VITE_API_URL).
const ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
export const apiUrl = (path) => (/^https?:\/\//.test(path) ? path : ORIGIN + path);
