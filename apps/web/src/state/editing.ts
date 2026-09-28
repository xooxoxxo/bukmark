import { create } from 'zustand';

/** The link whose edit dialog is open, if any. Rows and cards open it; LinksView renders it once. */
export const useEditing = create<{ id: string | null; open: (id: string) => void; close: () => void }>((set) => ({
  id: null,
  open: (id) => set({ id }),
  close: () => set({ id: null }),
}));
