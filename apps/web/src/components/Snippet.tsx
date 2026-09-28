import { HIT_END, HIT_START } from '../api/types';

/** The words around a search match inside the page, with the matched words marked. */
export function Snippet({ text, className }: { text: string; className?: string }) {
  const parts = text.split(HIT_START).flatMap((chunk, i) => {
    if (i === 0) return [{ hit: false, text: chunk }];
    const [hit = '', rest = ''] = chunk.split(HIT_END);
    return [{ hit: true, text: hit }, { hit: false, text: rest }];
  });
  return (
    <p className={className}>
      <span aria-hidden="true">…</span>
      {parts.map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : part.text))}
      <span aria-hidden="true">…</span>
    </p>
  );
}
