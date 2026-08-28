import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api'

export interface DocumentRow {
  id: number
  original_filename: string
  mime_type: string
  byte_size: number
  sha256_short: string
  description: string
  uploaded_at: string
  uploaded_by_name: string
}

interface DocumentsResponse {
  documents: DocumentRow[]
  limits: { max_bytes: number; allowed_extensions: string[] }
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Attachments on a record.
 *
 * The download link points at an authenticated endpoint, not at a file. There
 * is no public path to the blob, so a link that leaks out of somebody's inbox
 * is worth nothing to whoever finds it.
 */
export function Documents({
  entityType,
  entityId,
  perms,
  title = 'Documents',
}: {
  entityType: string
  entityId: number | string
  perms: Set<string>
  title?: string
}) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [description, setDescription] = useState('')

  const key = ['documents', entityType, String(entityId)]
  const q = useQuery<DocumentsResponse, ApiError>({
    queryKey: key,
    queryFn: async () =>
      (await api<DocumentsResponse>(`/api/documents?entity_type=${entityType}&entity_id=${entityId}`))
        .data,
    retry: false,
  })

  const canUpload = perms.has('document.upload')
  const canDelete = perms.has('document.delete')

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      // Order matters: the server checks permission on the owning record before
      // it writes a single byte, so these fields must precede the file.
      form.append('entity_type', entityType)
      form.append('entity_id', String(entityId))
      form.append('description', description)
      form.append('file', file)

      const res = await fetch('/api/documents', {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(body?.message ?? body?.error ?? `Upload failed (${res.status})`)
      }
      setDescription('')
      if (fileRef.current) fileRef.current.value = ''
      await qc.invalidateQueries({ queryKey: key })
      await qc.invalidateQueries({ queryKey: ['audit'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number, name: string) {
    if (!window.confirm(`Remove "${name}"?\n\nThe record is kept and the file is removed by the reaper after a grace period.`)) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api(`/api/documents/${id}`, { method: 'DELETE' })
      await qc.invalidateQueries({ queryKey: key })
      await qc.invalidateQueries({ queryKey: ['audit'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the document')
    } finally {
      setBusy(false)
    }
  }

  const docs = q.data?.documents ?? []
  const limits = q.data?.limits

  return (
    <div className="card">
      <div className="card-head">
        <h2>{title}</h2>
        <span className="hint">
          stored outside the web root under a random name · served only through an authenticated
          endpoint that checks permission on this record
        </span>
      </div>

      {error ? (
        <div style={{ padding: '12px 16px 0' }}>
          <div className="err">{error}</div>
        </div>
      ) : null}

      {docs.length === 0 ? (
        <div className="empty">No documents attached yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>File</th>
                <th>Description</th>
                <th className="num">Size</th>
                <th>SHA-256</th>
                <th>Uploaded</th>
                <th>By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="desc">
                    <a href={`/api/documents/${d.id}/download`}>{d.original_filename}</a>
                    <div className="desc-sub">{d.mime_type}</div>
                  </td>
                  <td className="small">{d.description || <span className="muted">—</span>}</td>
                  <td className="num small">{humanSize(d.byte_size)}</td>
                  <td className="mono small muted" title="first 12 hex characters of the digest">
                    {d.sha256_short}
                  </td>
                  <td className="small muted">
                    {new Date(d.uploaded_at).toISOString().slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="small">{d.uploaded_by_name}</td>
                  <td style={{ textAlign: 'right' }}>
                    {canDelete ? (
                      <button
                        className="btn small"
                        disabled={busy}
                        onClick={() => void remove(d.id, d.original_filename)}
                      >
                        remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canUpload ? (
        <div className="card-body" style={{ borderTop: '1px solid var(--line-2)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              ref={fileRef}
              type="file"
              disabled={busy}
              style={{ fontSize: 13 }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void upload(f)
              }}
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={description}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
              style={{
                flex: '1 1 220px',
                padding: '6px 10px',
                fontSize: 13,
                fontFamily: 'inherit',
                border: '1px solid var(--line)',
                borderRadius: 6,
              }}
            />
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>
            {busy
              ? 'Uploading…'
              : limits
                ? `Accepted: ${limits.allowed_extensions.join(', ')} · up to ${humanSize(limits.max_bytes)}. ` +
                  'The extension is checked against the file’s actual first bytes, so a renamed file is rejected.'
                : ''}
          </div>
        </div>
      ) : (
        <div className="card-body" style={{ borderTop: '1px solid var(--line-2)' }}>
          <span className="small muted">
            Your role does not hold <code>document.upload</code>.
          </span>
        </div>
      )}
    </div>
  )
}
