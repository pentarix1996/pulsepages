// Entry point. The logic lives in handler.ts and runner.ts (importable by tests without starting a server).
import { handleRunnerRequest } from './handler.ts'

Deno.serve((request) => handleRunnerRequest(request))
