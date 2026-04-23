/**
 * Snapshot utilities for deep cloning state.
 * Used for optimistic update rollback on failure.
 */

/**
 * Creates a deep clone of the given state using structuredClone.
 * Handles nested objects, arrays, and circular references.
 */
export function createSnapshot<T>(state: T): T {
  return structuredClone(state)
}

/**
 * Restores state from a snapshot.
 * Since createSnapshot uses structuredClone, the snapshot is already a deep clone,
 * so this just returns it. This function exists for semantic clarity and potential
 * future middleware/logic needs.
 */
export function restoreSnapshot<T>(snapshot: T): T {
  return snapshot
}
