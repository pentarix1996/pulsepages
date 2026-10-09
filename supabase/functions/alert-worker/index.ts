// Entry point. The logic lives in handler.ts and worker.ts (importable by tests without starting a server).
import { handleWorkerRequest } from './handler.ts'

Deno.serve((request) => handleWorkerRequest(request))
