import { useEffect, useRef, useState } from 'react';
import type { QuoteDto } from '../api/types';
import { copyText } from './copyText';

const COPIED_MS = 1600;

/**
 * Copy for one quote: puts it on the clipboard in the quote format, then says
 * "Copied" for 1.6s, or that the browser refused the clipboard.
 */
export function useCopyQuote(quote: Pick<QuoteDto, 'text' | 'sourceTitle' | 'sourceUrl'>) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(copyText(quote));
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
