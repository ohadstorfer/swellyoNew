import { useEffect, useState } from 'react';

/**
 * Debounce a value: returns `value` only after it has stayed unchanged for
 * `delay` milliseconds. Useful for filtering/search inputs where you want the
 * input to feel instant but the downstream work (filter, network call) to
 * settle on the final value.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}
