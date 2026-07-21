import { useEffect, useState } from 'react';
import { useFilters } from '../state/filters';

export function SearchBox() {
  const setQ = useFilters((s) => s.setQ);
  const [value, setValue] = useState(() => useFilters.getState().q);

  useEffect(() => {
    const timer = setTimeout(() => setQ(value), 300);
    return () => clearTimeout(timer);
  }, [value, setQ]);

  return (
    <input
      type="search"
      placeholder="Search links…"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      aria-label="Search links"
    />
  );
}
