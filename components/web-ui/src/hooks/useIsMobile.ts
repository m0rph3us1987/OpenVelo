import * as React from 'react';

const MOBILE_UA_REGEX = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mobi|Mobile|Tablet/i;

function detect(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (MOBILE_UA_REGEX.test(ua)) return true;
  if (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 768px)').matches
  ) {
    return true;
  }
  return typeof window.innerWidth === 'number' && window.innerWidth < 768;
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState<boolean>(detect);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const update = () => setIsMobile(detect());

    const mql =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(max-width: 768px)')
        : null;
    const onMqlChange = () => update();
    const onResize = () => update();
    const onOrientation = () => update();

    mql?.addEventListener('change', onMqlChange);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onOrientation);

    update();

    return () => {
      mql?.removeEventListener('change', onMqlChange);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onOrientation);
    };
  }, []);

  return isMobile;
}
