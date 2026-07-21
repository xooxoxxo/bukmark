import { create } from 'zustand';

export interface FiltersState {
  q: string;
  unassigned: boolean;
  status: 'active' | 'archived';
  setQ: (q: string) => void;
  setUnassigned: (v: boolean) => void;
  setStatus: (s: 'active' | 'archived') => void;
  reset: () => void;
}

const defaults = { q: '', unassigned: false, status: 'active' as const };

export const useFilters = create<FiltersState>((set) => ({
  ...defaults,
  setQ: (q) => set({ q }),
  setUnassigned: (unassigned) => set({ unassigned }),
  setStatus: (status) => set({ status }),
  reset: () => set(defaults),
}));
