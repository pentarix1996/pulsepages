// Legacy v0 public API, now a proxy to the Next public API (/api/v1). See proxy.ts.
import { handleApiRequest } from './proxy.ts'

Deno.serve((request) => handleApiRequest(request))
