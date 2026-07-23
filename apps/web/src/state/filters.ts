import { create } from 'zustand';

export interface FiltersState {
  q: string;
  unassigned: boolean;
  status: 'active' | 'archived';
  view: 'list' | 'grid';
  setQ: (q: string) => void;
  setUnassigned: (v: boolean) => void;
  setStatus: (s: 'active' | 'archived') => void;
  setView: (v: 'list' | 'grid') => void;
  reset: () => void;
}

const defaults = { q: '', unassigned: false, status: 'active' as const };

export const useFilters = create<FiltersState>((set) => ({
  ...defaults,
  view: 'list' as const,
  setQ: (q) => set({ q }),
  setUnassigned: (unassigned) => set({ unassigned }),
  setStatus: (status) => set({ status }),
  setView: (view) => set({ view }),
  reset: () => set(defaults),
}));
