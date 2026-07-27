const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const prisma = require('../utils/prisma');
const learningAccess = require('./learningAccessService');

const PRIVATE_ROOT = path.resolve(__dirname, '..', '..', 'storage', 'private', 'lms');
const ALLOWED_MIME = new Set(['application/pdf', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'video/mp4', 'text/plain']);

class LmsResourceError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}

async function persist(file, lessonId, data) {
  if (!file?.path || !file.size) throw new LmsResourceError('FILE_REQUIRED', 'Un fichier est obligatoire.');
  const detected = await import('file-type').then(({ fileTypeFromFile }) => fileTypeFromFile(file.path));
  const mimeType = detected?.mime || file.mimetype;
  if (!ALLOWED_MIME.has(mimeType)) throw new LmsResourceError('FILE_TYPE_FORBIDDEN', 'Ce format de fichier n’est pas autorisé.');
  const directory = path.join(PRIVATE_ROOT, String(new Date().getUTCFullYear()));
  await fs.mkdir(directory, { recursive: true });
  const extension = detected?.ext || 'bin';
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const target = path.join(directory, fileName);
  await fs.rename(file.path, target);
  return prisma.lessonResource.create({
    data: {
      lessonId: Number(lessonId), title: String(data.title || file.originalname).trim().slice(0, 180),
      type: data.type || 'DOCUMENT', position: Number(data.position), isPrivate: true,
      storageKey: path.posix.join(String(new Date().getUTCFullYear()), fileName),
      mimeType, originalFileName: path.basename(file.originalname).slice(0, 255), sizeBytes: file.size,
    },
  });
}

function resolveKey(key) {
  if (!/^\d{4}\/[a-f0-9-]{36}\.[a-z0-9]+$/.test(String(key || ''))) throw new LmsResourceError('RESOURCE_NOT_FOUND', 'Ressource introuvable.', 404);
  const absolutePath = path.resolve(PRIVATE_ROOT, ...key.split('/'));
  if (!absolutePath.startsWith(`${PRIVATE_ROOT}${path.sep}`)) throw new LmsResourceError('RESOURCE_NOT_FOUND', 'Ressource introuvable.', 404);
  return absolutePath;
}

async function studentFile(userId, enrollmentId, publicId) {
  const resource = await prisma.lessonResource.findUnique({ where: { publicId }, include: { lesson: true } });
  if (!resource?.isPrivate || !resource.storageKey) throw new LmsResourceError('RESOURCE_NOT_FOUND', 'Ressource introuvable.', 404);
  await learningAccess.getLesson(userId, enrollmentId, resource.lessonId);
  const absolutePath = resolveKey(resource.storageKey);
  try { await fs.access(absolutePath); } catch { throw new LmsResourceError('RESOURCE_NOT_FOUND', 'Ressource introuvable.', 404); }
  return { absolutePath, mimeType: resource.mimeType || 'application/octet-stream', downloadName: resource.originalFileName || resource.title };
}

module.exports = { LmsResourceError, PRIVATE_ROOT, persist, studentFile, resolveKey };
