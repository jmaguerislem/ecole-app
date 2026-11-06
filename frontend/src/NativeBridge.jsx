import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isNative } from './platform.js';

// Comportements propres à l'application native : bouton retour Android, ouverture d'une page depuis une notification
export default function NativeBridge() {
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    if (!isNative) return undefined;
    const go = (e) => nav(e.detail);
    window.addEventListener('native:navigate', go);
    return () => window.removeEventListener('native:navigate', go);
  }, [nav]);
  useEffect(() => {
    if (!isNative) return undefined;
    let handle;
    import('@capacitor/app').then(({ App }) => App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack && loc.pathname !== '/' && loc.pathname !== '/login') window.history.back(); else App.exitApp();
    })).then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, [loc.pathname]);
  return null;
}
