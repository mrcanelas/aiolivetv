import { useCallback, useMemo, useRef, useState } from 'react';

export function useDisclosure(
  initialState: boolean,
  callbacks?: { onOpen?(): void; onClose?(): void }
) {
  const [opened, setOpened] = useState(initialState);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const open = useCallback(() => {
    setOpened((current) => {
      if (!current) callbacksRef.current?.onOpen?.();
      return true;
    });
  }, []);

  const close = useCallback(() => {
    setOpened((current) => {
      if (current) callbacksRef.current?.onClose?.();
      return false;
    });
  }, []);

  const toggle = useCallback(() => {
    setOpened((current) => {
      if (current) {
        callbacksRef.current?.onClose?.();
        return false;
      }
      callbacksRef.current?.onOpen?.();
      return true;
    });
  }, []);

  return useMemo(
    () => ({ isOpen: opened, open, close, toggle }),
    [opened, open, close, toggle]
  );
}

export type UseDisclosureReturn = ReturnType<typeof useDisclosure>;

export function useBoolean(
  initialState: boolean,
  callbacks?: { onOpen?(): void; onClose?(): void }
) {
  const [opened, setOpened] = useState(initialState);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const open = useCallback(() => {
    setOpened((current) => {
      if (!current) callbacksRef.current?.onOpen?.();
      return true;
    });
  }, []);

  const close = useCallback(() => {
    setOpened((current) => {
      if (current) callbacksRef.current?.onClose?.();
      return false;
    });
  }, []);

  const toggle = useCallback(() => {
    setOpened((current) => {
      if (current) {
        callbacksRef.current?.onClose?.();
        return false;
      }
      callbacksRef.current?.onOpen?.();
      return true;
    });
  }, []);

  return useMemo(
    () => ({
      active: opened,
      on: open,
      off: close,
      toggle,
      set: setOpened,
    }),
    [opened, open, close, toggle]
  );
}
