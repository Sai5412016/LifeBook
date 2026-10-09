import { beforeEach, describe, expect, it } from 'vitest';

import { useDeleteUndoStore } from './delete-undo';

describe('delete-undo store', () => {
  beforeEach(() => {
    useDeleteUndoStore.setState({ pending: null });
  });

  it('starts empty', () => {
    expect(useDeleteUndoStore.getState().pending).toBeNull();
  });

  it('announce stores the deleted dose and its label', () => {
    useDeleteUndoStore.getState().announce('m1', 'Gelöscht: Vitamin D3 · 09:12');
    const pending = useDeleteUndoStore.getState().pending;
    expect(pending?.entryId).toBe('m1');
    expect(pending?.label).toBe('Gelöscht: Vitamin D3 · 09:12');
  });

  it('announcing the SAME dose twice gives a new token each time', () => {
    const { announce } = useDeleteUndoStore.getState();
    announce('m1', 'a');
    const first = useDeleteUndoStore.getState().pending?.token;
    announce('m1', 'a');
    expect(useDeleteUndoStore.getState().pending?.token).not.toBe(first);
  });

  it('clear removes the offer when the token still matches', () => {
    useDeleteUndoStore.getState().announce('m1', 'a');
    const token = useDeleteUndoStore.getState().pending!.token;
    useDeleteUndoStore.getState().clear(token);
    expect(useDeleteUndoStore.getState().pending).toBeNull();
  });

  it('an older timer never wipes a newer announcement', () => {
    useDeleteUndoStore.getState().announce('m1', 'a');
    const oldToken = useDeleteUndoStore.getState().pending!.token;
    useDeleteUndoStore.getState().announce('m2', 'b');
    useDeleteUndoStore.getState().clear(oldToken);
    expect(useDeleteUndoStore.getState().pending?.entryId).toBe('m2');
  });
});
