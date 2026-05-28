// Per-step inline validation registry — replaces the legacy Alert.alert('Hold on') pattern
// used by the create-trip wizard. See docs/create-trip-redesign-spec.md §9 Stream A.

import { useCallback, useMemo, useRef, useState } from 'react';

export interface UseFieldErrorsApi<TField extends string> {
  errors: Partial<Record<TField, string>>;
  setError: (field: TField, msg: string | null) => void;
  clearErrors: () => void;
  hasErrors: boolean;
  firstErrorField: TField | null;
}

export function useFieldErrors<TField extends string>(): UseFieldErrorsApi<TField> {
  const [errors, setErrors] = useState<Partial<Record<TField, string>>>({});
  // Insertion order is tracked so firstErrorField is stable in the order setError was first called.
  const orderRef = useRef<TField[]>([]);

  const setError = useCallback((field: TField, msg: string | null) => {
    setErrors(prev => {
      const next: Partial<Record<TField, string>> = { ...prev };
      if (msg == null || msg === '') {
        delete next[field];
        orderRef.current = orderRef.current.filter(f => f !== field);
      } else {
        next[field] = msg;
        if (!orderRef.current.includes(field)) {
          orderRef.current = [...orderRef.current, field];
        }
      }
      return next;
    });
  }, []);

  const clearErrors = useCallback(() => {
    orderRef.current = [];
    setErrors({});
  }, []);

  const hasErrors = useMemo(() => {
    return Object.keys(errors).length > 0;
  }, [errors]);

  const firstErrorField = useMemo<TField | null>(() => {
    const ordered = orderRef.current.find(f => errors[f]);
    if (ordered) return ordered;
    const keys = Object.keys(errors) as TField[];
    return keys.length > 0 ? keys[0] : null;
  }, [errors]);

  return { errors, setError, clearErrors, hasErrors, firstErrorField };
}
