import { can as canDo, type PermissionKey, type SessionUser } from '@loja/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api, ApiError, setUnauthorizedHandler } from './api.ts';

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  can(key: PermissionKey): boolean;
  canAny(keys: PermissionKey[]): boolean;
  setUser(user: SessionUser | null): void;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api.get<{ user: SessionUser }>('/api/auth/me')).user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: 1,
  });

  const setUser = useCallback((user: SessionUser | null) => {
    if (!user) queryClient.clear();
    queryClient.setQueryData(['me'], user);
  }, [queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (queryClient.getQueryData(['me'])) setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient, setUser]);

  const value = useMemo<AuthContextValue>(() => {
    const user = me.data ?? null;
    return {
      user,
      loading: me.isPending,
      can: (key) => canDo(user, key),
      canAny: (keys) => keys.some((key) => canDo(user, key)),
      setUser,
      logout: async () => {
        try {
          await api.post('/api/auth/logout');
        } finally {
          setUser(null);
        }
      },
    };
  }, [me.data, me.isPending, setUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth fora do AuthProvider');
  return context;
}

export function useUser(): SessionUser {
  const { user } = useAuth();
  if (!user) throw new Error('Usuário não autenticado');
  return user;
}
