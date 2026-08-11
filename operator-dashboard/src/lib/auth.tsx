import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

type AuthValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /**
   * `surfers.operator` for the signed-in account. `null` means "not answered
   * yet" and is NOT the same as false — rendering the locked-out page while
   * this is null would flash a rejection at every operator on every load.
   *
   * This is a FRONT DOOR, not a lock. Every read this site makes is already
   * scoped by RLS to trips you host, so a person who forces this to true still
   * sees an empty list. It exists so someone who is not an operator gets a
   * clear answer instead of a blank dashboard.
   */
  isOperator: boolean | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOperator, setIsOperator] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;

    // getSession reads what is already stored — it never blocks on the network,
    // unlike getUser, which can hang and leave the page blank.
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!alive) return;
      setSession(next);
      setLoading(false);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Read `surfers.operator` for whoever is signed in. Keyed on the user id so
  // it re-runs on a real account change and NOT on every token refresh — an
  // onAuthStateChange fires a new Session object roughly hourly, and using
  // `session` here would refetch on each one.
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId) {
      setIsOperator(null);
      return;
    }
    let alive = true;
    setIsOperator(null);

    supabase
      .from('surfers')
      .select('operator')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        // Fail CLOSED. A read that errored, or an account with no surfer row
        // (signed up on the web and never onboarded), is not an operator.
        if (error) {
          console.error('[auth] could not read operator flag:', error.message);
          setIsOperator(false);
          return;
        }
        setIsOperator(Boolean(data?.operator));
      });

    return () => {
      alive = false;
    };
  }, [userId]);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      isOperator,
      signIn: async () => {
        await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin },
        });
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, loading, isOperator],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
