import { describe, it, expect } from 'vitest'
import { createSnapshot, restoreSnapshot } from '@/lib/store/snapshot'

describe('createSnapshot', () => {
  it('creates a deep clone of a simple object', () => {
    const original = { name: 'test', value: 42 }
    const snapshot = createSnapshot(original)

    expect(snapshot).toEqual(original)
    expect(snapshot).not.toBe(original)
  })

  it('creates a deep clone of a nested object', () => {
    const original = {
      id: '1',
      nested: { name: 'nested', value: 123 },
      components: [{ id: 'c1', name: 'Comp 1', status: 'operational' }],
    }
    const snapshot = createSnapshot(original)

    expect(snapshot).toEqual(original)
    expect(snapshot).not.toBe(original)
    expect(snapshot.nested).not.toBe(original.nested)
    expect(snapshot.components).not.toBe(original.components)
    expect(snapshot.components[0]).not.toBe(original.components[0])
  })

  it('creates a deep clone of an array', () => {
    const original = [
      { id: '1', name: 'Project 1' },
      { id: '2', name: 'Project 2' },
    ]
    const snapshot = createSnapshot(original)

    expect(snapshot).toEqual(original)
    expect(snapshot).not.toBe(original)
    expect(snapshot[0]).not.toBe(original[0])
  })

  it('handles empty objects and arrays', () => {
    expect(createSnapshot({})).toEqual({})
    expect(createSnapshot([])).toEqual([])
  })

  it('preserves referential equality within cloned structure', () => {
    const shared = { id: 'shared' }
    const original = {
      first: shared,
      second: shared,
    }
    const snapshot = createSnapshot(original)

    expect(snapshot.first).toBe(snapshot.second)
    expect(snapshot.first).not.toBe(original.first)
  })
})

describe('restoreSnapshot', () => {
  it('returns the snapshot as-is', () => {
    const original = { name: 'test', value: 42 }
    const snapshot = createSnapshot(original)
    const restored = restoreSnapshot(snapshot)

    expect(restored).toBe(snapshot)
    expect(restored).toEqual(original)
  })

  it('returns the snapshot even for complex nested structures', () => {
    const original = {
      projects: [
        { id: '1', name: 'Project 1', components: [] },
        { id: '2', name: 'Project 2', components: [{ id: 'c1', name: 'Comp 1', status: 'operational' }] },
      ],
      incidents: [],
    }
    const snapshot = createSnapshot(original)
    const restored = restoreSnapshot(snapshot)

    expect(restored).toBe(snapshot)
    expect(restored.projects[1].components[0]).toBe(snapshot.projects[1].components[0])
  })
})
