/**
 * medication/delete-undo — hands "a dose was just deleted, offer Rückgängig"
 * from the edit screen (app/alltag/gabe.tsx) to whichever screen it was
 * opened from (the Alltag tab or "Mehr …"), which shows it in the existing
 * snackbar style (components/gabe-undo-snackbar.tsx). A tiny zustand store
 * (already a project dependency) because the two screens are different
 * routes and share no React tree.
 *
 * Pure state, no Expo import — testable under Vitest. The announcing side
 * has ALREADY soft-deleted the row; this only carries the offer to undo it.
 */

import { create } from 'zustand';

export type PendingUndo = {
  /** Changes with every announcement, so the same dose can be announced twice. */
  token: number;
  /** The soft-deleted `medications` row. */
  entryId: string;
  label: string;
};

type DeleteUndoState = {
  pending: PendingUndo | null;
  announce: (entryId: string, label: string) => void;
  /** Clears only if `token` is still the pending one — a newer announcement is never wiped by an older timer. */
  clear: (token: number) => void;
};

let counter = 0;

export const useDeleteUndoStore = create<DeleteUndoState>((set, get) => ({
  pending: null,
  announce: (entryId, label) => {
    counter += 1;
    set({ pending: { token: counter, entryId, label } });
  },
  clear: (token) => {
    if (get().pending?.token === token) {
      set({ pending: null });
    }
  },
}));
