import * as React from 'react';
import { useSearchParams } from 'react-router-dom';

export interface ViewStackApi {
  view: 'list' | 'panel';
  activeChatId: number | null;
  push: (chatId: number) => void;
  select: (chatId: number) => void;
  back: () => void;
  pendingDeepLinkChatId: number | null;
}

export function useViewStack(): ViewStackApi {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('chat');
  const activeChatId = React.useMemo<number | null>(() => {
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  }, [raw]);

  const push = React.useCallback(
    (chatId: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('chat', String(chatId));
          return next;
        },
        { replace: false }
      );
    },
    [setSearchParams]
  );

  const select = React.useCallback(
    (chatId: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('chat', String(chatId));
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const back = React.useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('chat');
        return next;
      },
      { replace: false }
    );
  }, [setSearchParams]);

  return {
    view: activeChatId === null ? 'list' : 'panel',
    activeChatId,
    push,
    select,
    back,
    pendingDeepLinkChatId: null,
  };
}
