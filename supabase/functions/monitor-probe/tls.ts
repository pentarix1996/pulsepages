// TLS handshake through node:tls (Deno's Deno.connectTls cannot connect to an IP while verifying another name).
// Connects to the SSRF-validated address with SNI = hostname and reports the peer certificate without rejecting it,
// so expired or untrusted certificates become readable check results instead of connection errors.
import tls from 'node:tls'
import { parseCertificateDate } from '../_shared/monitoring/probe.ts'
import type { TlsHandshakeInput, TlsPeer } from './checks.ts'

function firstName(value: unknown): string | null {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null
  return typeof value === 'string' && value !== '' ? value : null
}

export function tlsHandshake(input: TlsHandshakeInput): Promise<TlsPeer> {
  return new Promise<TlsPeer>((resolve, reject) => {
    if (input.signal.aborted) {
      reject(input.signal.reason)
      return
    }
    const socket = tls.connect({ host: input.address, port: input.port, servername: input.servername ?? undefined, rejectUnauthorized: false })
    let settled = false
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      input.signal.removeEventListener('abort', onAbort)
      socket.destroy()
      settle()
    }
    const onAbort = () => finish(() => reject(input.signal.reason))
    input.signal.addEventListener('abort', onAbort, { once: true })

    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate()
      const hasCertificate = cert !== null && typeof cert === 'object' && Object.keys(cert).length > 0
      let authorized = socket.authorized === true
      let authorizationError = socket.authorizationError ? String(socket.authorizationError) : null
      if (authorized && hasCertificate) {
        // Chain verification does not always cover the name; check it explicitly.
        const identityError = tls.checkServerIdentity(input.hostname, cert)
        if (identityError) {
          authorized = false
          authorizationError = (identityError as Error & { code?: string }).code ?? identityError.message
        }
      }
      const peer: TlsPeer = {
        validFrom: hasCertificate ? parseCertificateDate(cert.valid_from) : null,
        validTo: hasCertificate ? parseCertificateDate(cert.valid_to) : null,
        authorized,
        authorizationError,
        subject: hasCertificate ? firstName(cert.subject?.CN) : null,
        issuer: hasCertificate ? firstName(cert.issuer?.O) ?? firstName(cert.issuer?.CN) : null,
        protocol: socket.getProtocol() ?? null,
      }
      finish(() => resolve(peer))
    })
    socket.once('error', (error: Error) => finish(() => reject(error)))
  })
}
