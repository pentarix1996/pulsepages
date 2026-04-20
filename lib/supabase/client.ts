import { createBrowserClient } from '@supabase/ssr'

let client: ReturnType<typeof createBrowserClient> | null = null

// Real in-memory lock queue to replace navigator.locks
// This ensures true serialization without HMR/React lock orphaning.
const lockQueue: Record<string, Promise<any>> = {}

async function inMemoryLock(name: string, acquireTimeout: number, fn: () => Promise<any>): Promise<any> {
  const currentLock = lockQueue[name] || Promise.resolve()
  
  const lockPromise = currentLock.then(async () => {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err
      }
      throw err
    }
  })
  
  lockQueue[name] = lockPromise.catch(() => {}) // Prevent unhandled rejections breaking queue
  return lockPromise
}

export function createClient() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          lock: inMemoryLock,
        },
      }
    )
  }
  return client
}

