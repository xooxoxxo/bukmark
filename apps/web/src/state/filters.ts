import { create } from 'zustand';
import type { LinkSort } from '../api/types';

export interface FiltersState {
  q: string;
  unassigned: boolean;
  broken: boolean;
  status: 'active' | 'archived';
  sort: LinkSort;
  view: 'list' | 'grid';
  setQ: (q: string) => void;
  setUnassigned: (v: boolean) => void;
  setBroken: (v: boolean) => void;
  setStatus: (s: 'active' | 'archived') => void;
  setSort: (s: LinkSort) => void;
  setView: (v: 'list' | 'grid') => void;
  reset: () => void;
}

const defaults = { q: '', unassigned: false, broken: false, status: 'active' as const };

export const useFilters = create<FiltersState>((set) => ({
  ...defaults,
  // Like the view, the sort is a way of looking, not a filter: reset keeps it.
  sort: 'relevance' as const,
  view: 'list' as const,
  setQ: (q) => set({ q }),
  setUnassigned: (unassigned) => set({ unassigned }),
  setBroken: (broken) => set({ broken }),
  setStatus: (status) => set({ status }),
  setSort: (sort) => set({ sort }),
  setView: (view) => set({ view }),
  reset: () => set(defaults),
}));
