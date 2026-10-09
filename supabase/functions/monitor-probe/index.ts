// Entry point. The logic lives in handler.ts (importable by tests and local tooling without starting a server).
import { handleProbeRequest } from './handler.ts'

Deno.serve((request) => handleProbeRequest(request))
