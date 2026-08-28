import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import type { Db } from '../db/db.ts'
import { requirePermission } from '../core/auth.ts'
import { writeAudit } from '../core/audit.ts'
import {
  ALLOWED_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  UploadRejected,
  contentDisposition,
  fileExists,
  safeJoin,
  storeUpload,
} from '../core/storage.ts'
import {
  ENTITY_TYPES,
  type EntityType,
  checkEntityAccess,
  listDocuments,
} from './documents.service.ts'

function parseEntity(q: unknown): { type: EntityType; id: number } | null {
  const { entity_type, entity_id } = (q ?? {}) as { entity_type?: string; entity_id?: string }
  if (!entity_type || !ENTITY_TYPES.includes(entity_type as EntityType)) return null
  const id = Number(entity_id)
  if (!Number.isInteger(id) || id <= 0) return null
  return { type: entity_type as EntityType, id }
}

export function documentRoutes(app: FastifyInstance, db: Db) {
  app.get(
    '/api/documents',
    { config: { permission: 'project.read' }, preHandler: requirePermission('project.read') },
    async (req, reply) => {
      const target = parseEntity(req.query)
      if (!target) return reply.code(400).send({ error: 'invalid_entity' })

      const access = await checkEntityAccess(db, req.auth!, target.type, target.id)
      // 404 whether the record is missing or merely out of reach. A 403 would
      // confirm the record exists, which is itself information.
      if (!access.ok) return reply.code(404).send({ error: 'not_found' })

      return {
        documents: await listDocuments(db, target.type, target.id),
        limits: {
          max_bytes: MAX_UPLOAD_BYTES,
          allowed_extensions: ALLOWED_EXTENSIONS,
        },
      }
    },
  )

  /**
   * Upload. Multipart, streamed straight to disk while hashing — the file is
   * never held in memory, so a 15 MB cap is a cap on disk and not on RAM.
   */
  app.post(
    '/api/documents',
    { config: { permission: 'document.upload' }, preHandler: requirePermission('document.upload') },
    async (req, reply) => {
      const auth = req.auth!

      if (!req.isMultipart()) {
        return reply.code(400).send({ error: 'expected_multipart' })
      }

      // Fields accumulate as they stream in; the target is only resolved once
      // both parts of it have arrived.
      const fields: Record<string, string> = {}
      let target: { type: EntityType; id: number } | null = null
      let description = ''
      let saved: Awaited<ReturnType<typeof storeUpload>> | null = null
      let originalFilename = ''

      try {
        for await (const part of req.parts()) {
          if (part.type === 'field') {
            fields[part.fieldname] = String(part.value)
            if (part.fieldname === 'description') description = String(part.value).slice(0, 500)
            target = parseEntity(fields) ?? target
            continue
          }

          // The file part comes last in a well-formed request, but do not rely
          // on the client for that: resolve and authorise the target BEFORE a
          // single byte is written to disk. Otherwise an unauthorised caller
          // still gets to fill the volume.
          if (!target) {
            return reply.code(400).send({
              error: 'entity_first',
              message: 'Send entity_type and entity_id before the file part.',
            })
          }
          const access = await checkEntityAccess(db, auth, target.type, target.id)
          if (!access.ok) return reply.code(404).send({ error: 'not_found' })

          originalFilename = part.filename ?? 'upload'
          saved = await storeUpload(part.file, originalFilename, new Date())
        }
      } catch (err) {
        if (err instanceof UploadRejected) {
          return reply.code(400).send({ error: 'rejected', message: err.message })
        }
        throw err
      }

      if (!target || !saved) {
        return reply.code(400).send({ error: 'missing_file' })
      }
      // Bind the narrowed values to consts before they cross into the closure.
      const entity = target
      const file = saved

      const doc = await db.transaction().execute(async (trx) => {
        const inserted = await trx
          .insertInto('documents')
          .values({
            entity_type: entity.type,
            entity_id: entity.id,
            original_filename: originalFilename,
            stored_name: file.storedName,
            storage_path: file.storagePath,
            mime_type: file.mimeType,
            byte_size: file.byteSize,
            sha256: file.sha256,
            description,
            uploaded_by: auth.userId,
          })
          .returning(['id', 'original_filename'])
          .executeTakeFirstOrThrow()

        await writeAudit(
          trx,
          { userId: auth.userId, ip: req.ip, requestId: req.id },
          {
            entityType: 'document',
            entityId: inserted.id,
            action: 'document.upload',
            summary: `Attached "${originalFilename}" to ${entity.type} ${entity.id}`,
            context: {
              attached_to: `${entity.type}#${entity.id}`,
              bytes: file.byteSize,
              sha256: file.sha256.slice(0, 16),
            },
          },
        )

        return inserted
      })

      return reply.code(201).send({ id: doc.id, filename: doc.original_filename })
    },
  )

  /**
   * Download.
   *
   * Permission is checked on the owning record and only then are bytes
   * streamed. The file is not in the web root and nginx never serves it, so a
   * URL that leaks out of an email is worth nothing to whoever finds it.
   *
   * Every download is written to the audit log. On a system holding supplier
   * pricing, who read what is exactly the question that gets asked later.
   */
  app.get(
    '/api/documents/:id/download',
    { config: { permission: 'project.read' }, preHandler: requirePermission('project.read') },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id)
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' })
      const auth = req.auth!

      const doc = await db
        .selectFrom('documents')
        .select([
          'id',
          'entity_type',
          'entity_id',
          'original_filename',
          'storage_path',
          'mime_type',
          'byte_size',
          'deleted_at',
        ])
        .where('id', '=', id)
        .executeTakeFirst()

      if (!doc || doc.deleted_at) return reply.code(404).send({ error: 'not_found' })

      const access = await checkEntityAccess(db, auth, doc.entity_type as EntityType, doc.entity_id)
      if (!access.ok) {
        // Worth recording: someone asked for a document they were not entitled
        // to. One of these is a mistyped URL; a hundred is an incident.
        await db.transaction().execute(async (trx) => {
          await writeAudit(
            trx,
            { userId: auth.userId, ip: req.ip, requestId: req.id },
            {
              entityType: 'document',
              entityId: id,
              action: 'document.download_denied',
              summary: `Denied access to "${doc.original_filename}"`,
              context: { reason: access.reason, attached_to: `${doc.entity_type}#${doc.entity_id}` },
            },
          )
        })
        return reply.code(404).send({ error: 'not_found' })
      }

      if (!(await fileExists(doc.storage_path))) {
        // The row says the blob is there and it is not. Say so plainly rather
        // than returning a zero-byte file that looks like a corrupt document.
        req.log.error({ documentId: id, path: doc.storage_path }, 'document row has no blob')
        return reply.code(410).send({ error: 'blob_missing' })
      }

      await db.transaction().execute(async (trx) => {
        await writeAudit(
          trx,
          { userId: auth.userId, ip: req.ip, requestId: req.id },
          {
            entityType: 'document',
            entityId: id,
            action: 'document.download',
            summary: `Downloaded "${doc.original_filename}"`,
            context: { attached_to: `${doc.entity_type}#${doc.entity_id}` },
          },
        )
      })

      reply
        .header('Content-Type', doc.mime_type)
        .header('Content-Length', String(doc.byte_size))
        // Always an attachment, never rendered in the tab. Combined with
        // nosniff (set globally in app.ts) a crafted upload cannot execute in a
        // colleague's browser.
        .header('Content-Disposition', contentDisposition(doc.original_filename))
        .header('Cache-Control', 'private, no-store')

      return reply.send(createReadStream(safeJoin(doc.storage_path)))
    },
  )

  /**
   * Delete — soft. The row is marked and the blob is removed later by a
   * separate reaper after a grace period.
   *
   * Two reasons. Somebody deletes the wrong attachment on a Friday afternoon
   * and wants it back on Monday. And unlinking a path straight out of the
   * database, at the moment a request asks you to, is how a bad path takes
   * something else with it.
   */
  app.delete(
    '/api/documents/:id',
    { config: { permission: 'document.delete' }, preHandler: requirePermission('document.delete') },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id)
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' })
      const auth = req.auth!

      const doc = await db
        .selectFrom('documents')
        .select(['id', 'entity_type', 'entity_id', 'original_filename', 'deleted_at'])
        .where('id', '=', id)
        .executeTakeFirst()

      if (!doc || doc.deleted_at) return reply.code(404).send({ error: 'not_found' })

      const access = await checkEntityAccess(db, auth, doc.entity_type as EntityType, doc.entity_id)
      if (!access.ok) return reply.code(404).send({ error: 'not_found' })

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('documents')
          .set({ deleted_at: new Date(), deleted_by: auth.userId })
          .where('id', '=', id)
          .execute()

        await writeAudit(
          trx,
          { userId: auth.userId, ip: req.ip, requestId: req.id },
          {
            entityType: 'document',
            entityId: id,
            action: 'document.delete',
            summary: `Removed "${doc.original_filename}" from ${doc.entity_type} ${doc.entity_id}`,
            context: { soft_delete: true, blob_removed_by: 'reaper after grace period' },
          },
        )
      })

      return { ok: true }
    },
  )
}
