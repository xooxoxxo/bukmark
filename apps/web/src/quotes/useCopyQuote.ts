import type { QuoteDto } from '../api/types';
import { useCopy } from '../components/useCopy';
import { copyText } from './copyText';

/** Copy for one quote, in the quote format (see useCopy). */
export function useCopyQuote(quote: Pick<QuoteDto, 'text' | 'sourceTitle' | 'sourceUrl'>) {
  return useCopy(() => copyText(quote));
}
