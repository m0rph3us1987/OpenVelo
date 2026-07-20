import * as React from 'react';

interface UseSwipeBackArgs {
  enabled: boolean;
  onBack: () => void;
}

export function useSwipeBack({ enabled, onBack }: UseSwipeBackArgs): void {
  const onBackRef = React.useRef(onBack);
  onBackRef.current = onBack;

  React.useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      if (!t) return;
      if (t.clientX > 24) return;
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    }

    function onTouchMove() {
      if (!tracking) return;
    }

    function onTouchEnd(e: TouchEvent) {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (dx >= 50 && Math.abs(dy) <= 40) {
        onBackRef.current();
      }
    }

    function onTouchCancel() {
      tracking = false;
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [enabled]);
}
