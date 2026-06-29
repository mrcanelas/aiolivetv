import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type QuickAction = {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  /** Optional keyboard hint for display */
  shortcut?: string;
  /** Search keywords */
  keywords?: string[];
  onSelect: () => void;
};

type QuickActionsContextType = {
  actions: QuickAction[];
  register: (action: QuickAction) => () => void;
};

const QuickActionsContext = createContext<QuickActionsContextType>({
  actions: [],
  register: () => () => {},
});

export function QuickActionsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [version, setVersion] = useState(0);
  const actionsRef = useRef<Map<string, QuickAction>>(new Map());

  const register = useCallback((action: QuickAction) => {
    actionsRef.current.set(action.id, action);
    setVersion((value) => value + 1);
    return () => {
      actionsRef.current.delete(action.id);
      setVersion((value) => value + 1);
    };
  }, []);

  const value = useMemo<QuickActionsContextType>(
    () => ({
      actions: Array.from(actionsRef.current.values()),
      register,
    }),
    [register, version]
  );

  return (
    <QuickActionsContext.Provider value={value}>
      {children}
    </QuickActionsContext.Provider>
  );
}

export const useQuickActions = () => useContext(QuickActionsContext);

/** Convenience hook to register a quick action while a component is mounted. */
export function useRegisterQuickAction(action: QuickAction | null) {
  const { register } = useQuickActions();
  const actionRef = useRef(action);
  actionRef.current = action;

  useEffect(() => {
    if (!action) return;
    return register({
      id: action.id,
      label: action.label,
      description: action.description,
      icon: action.icon,
      shortcut: action.shortcut,
      keywords: action.keywords,
      onSelect: () => actionRef.current?.onSelect(),
    });
  }, [action?.id, action?.label, register]);
}
