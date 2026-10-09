import { appHandler } from '@/lib/http/app'
import { invalid } from '@/lib/domain/errors'
import { LOGO_MAX_BYTES } from '@/lib/domain/schemas/status-page'
import { uploadProjectLogo } from '@/lib/domain/status-page-settings'

/**
 * POST multipart/form-data with a `file` field (PNG, JPEG, WebP or SVG up to 1 MB). Returns the public URL; the
 * settings form saves it as logo_url through PATCH /api/app/projects/{id}.
 */
export const POST = appHandler<{ projectId: string }>(async ({ ctx, params, request }) => {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > LOGO_MAX_BYTES + 64 * 1024) throw invalid('Logos can be up to 1 MB. Export a smaller image.')
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw invalid('Send the logo as multipart/form-data in a field named file.')
  }
  const file = form.get('file')
  if (!(file instanceof File)) throw invalid('Choose an image to upload.', [{ path: 'file', message: 'Choose an image to upload.' }])
  const bytes = new Uint8Array(await file.arrayBuffer())
  return { data: await uploadProjectLogo(ctx, params.projectId, { size: bytes.byteLength, type: file.type, bytes }), status: 201 }
})
