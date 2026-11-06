import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Build « native » (Capacitor) : l'application n'est pas servie par le backend, l'URL de l'API est obligatoire.
  if (mode === 'native') {
    const url = loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL || '';
    if (!/^https:\/\//.test(url) || url.includes('VOTRE-BACKEND')) {
      throw new Error('Renseignez VITE_API_URL (https://…) dans frontend/.env.native avant « npm run build:native ».');
    }
  }
  return {
    plugins: [react()],
    server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
  };
});
