import { create } from 'zustand';

export interface SelectionState {
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  setMany: (ids: string[], on: boolean) => void;
  clear: () => void;
}

export const useSelection = create<SelectionState>((set) => ({
  selected: new Set<string>(),
  toggle: (id) =>
    set((s) => {
      const next = new Set(s.selected);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selected: next };
    }),
  setMany: (ids, on) =>
    set((s) => {
      const next = new Set(s.selected);
      for (const id of ids) {
        if (on) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return { selected: next };
    }),
  clear: () => set({ selected: new Set<string>() }),
}));
