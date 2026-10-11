import { useEffect, useRef, useState } from 'react';

const COPIED_MS = 1600;

/**
 * A Copy button's state: puts the text on the clipboard, then says "Copied"
 * for 1.6s, or that the browser refused the clipboard.
 */
export function useCopy(text: () => string) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text());
    } catch {
      setCopied(false);
      setFailed(true);
      return;
    }
    setFailed(false);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  return { copied, failed, copy };
}
