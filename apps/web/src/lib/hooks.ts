import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

export function useHotkeys(map: HotkeyMap, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const handler = ref.current[event.key];
      if (!handler) return;
      if (document.querySelector('[role="dialog"][data-state="open"]') && event.key !== 'Escape') return;
      handler(event);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export type SearchPatch = Record<string, string | null | undefined>;

export function useSearchState() {
  const [params, setParams] = useSearchParams();
  const update = useCallback(
    (patch: SearchPatch) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [params, update] as const;
}

export function useSearchText(value: string, onCommit: (value: string) => void) {
  const [text, setText] = useState(value);
  const debounced = useDebounced(text.trim(), 300);
  useEffect(() => {
    if (debounced !== value) onCommit(debounced);
  }, [debounced]);
  useEffect(() => {
    if (value !== text.trim()) setText(value);
  }, [value]);
  return [text, setText] as const;
}

export function useStoredFlag(key: string, initial = false): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === '1';
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next ? '1' : '0');
      } catch {
        return;
      }
    },
    [key],
  );
  return [value, update];
}
