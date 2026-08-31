const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const PRIVATE_ROOT = path.resolve(process.env.PRIVATE_STORAGE_ROOT || path.join(__dirname, '..', '..', 'storage', 'private'), 'oral-audio');
const TEMP_ROOT = path.join(PRIVATE_ROOT, '.tmp');
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const SUPPORTED_AUDIO = Object.freeze({
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  mp4: 'audio/mp4',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
});

class OralAudioStorageError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'OralAudioStorageError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function ensureDirectories() {
  await Promise.all([
    fs.mkdir(PRIVATE_ROOT, { recursive: true }),
    fs.mkdir(TEMP_ROOT, { recursive: true }),
  ]);
}

async function inspectTemporaryFile(file, maxDurationSeconds) {
  if (!file?.path) throw new OralAudioStorageError('AUDIO_REQUIRED', 'Un fichier audio est obligatoire.');
  if (!Number.isInteger(file.size) || file.size <= 0 || file.size > MAX_AUDIO_BYTES) {
    throw new OralAudioStorageError('AUDIO_SIZE_INVALID', 'La taille du fichier audio est invalide.');
  }
  const [{ fileTypeFromFile }, { parseFile }] = await Promise.all([
    import('file-type'),
    import('music-metadata'),
  ]);
  const detected = await fileTypeFromFile(file.path);
  if (!detected || !SUPPORTED_AUDIO[detected.ext]) {
    throw new OralAudioStorageError('AUDIO_TYPE_INVALID', 'Le fichier fourni n’est pas un format audio autorisé.');
  }
  let metadata;
  try {
    metadata = await parseFile(file.path, { duration: true, skipCovers: true });
  } catch {
    throw new OralAudioStorageError('AUDIO_UNREADABLE', 'Le fichier audio est illisible ou endommagé.');
  }
  const duration = metadata.format.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new OralAudioStorageError('AUDIO_DURATION_UNKNOWN', 'La durée du fichier audio ne peut pas être vérifiée.');
  }
  const durationSeconds = Math.ceil(duration);
  if (durationSeconds > maxDurationSeconds) {
    throw new OralAudioStorageError('AUDIO_TOO_LONG', `L’enregistrement dépasse la durée maximale de ${maxDurationSeconds} secondes.`);
  }
  const contents = await fs.readFile(file.path);
  return {
    extension: detected.ext === 'm4a' ? 'mp4' : detected.ext,
    mimeType: SUPPORTED_AUDIO[detected.ext],
    sizeBytes: file.size,
    durationSeconds,
    checksum: crypto.createHash('sha256').update(contents).digest('hex'),
  };
}

async function persistTemporaryFile(file, inspection) {
  await ensureDirectories();
  const now = new Date();
  const relativeDirectory = path.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
  const targetDirectory = path.join(PRIVATE_ROOT, relativeDirectory);
  await fs.mkdir(targetDirectory, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${inspection.extension}`;
  const storageKey = path.posix.join(relativeDirectory.replaceAll('\\', '/'), fileName);
  const target = path.join(targetDirectory, fileName);
  await fs.rename(file.path, target);
  return { storageKey, absolutePath: target, ...inspection };
}

function resolveStorageKey(storageKey) {
  const key = String(storageKey || '');
  if (!/^[0-9]{4}\/[0-9]{2}\/[a-f0-9-]{36}\.(?:webm|ogg|mp3|mp4|wav)$/.test(key)) {
    throw new OralAudioStorageError('AUDIO_PATH_INVALID', 'Fichier audio inaccessible.', 404);
  }
  const absolutePath = path.resolve(PRIVATE_ROOT, ...key.split('/'));
  if (!absolutePath.startsWith(`${PRIVATE_ROOT}${path.sep}`)) {
    throw new OralAudioStorageError('AUDIO_PATH_INVALID', 'Fichier audio inaccessible.', 404);
  }
  return absolutePath;
}

async function stat(storageKey) {
  const absolutePath = resolveStorageKey(storageKey);
  try {
    const information = await fs.stat(absolutePath);
    if (!information.isFile()) throw new Error();
    return { absolutePath, size: information.size };
  } catch {
    throw new OralAudioStorageError('AUDIO_NOT_FOUND', 'Fichier audio inaccessible.', 404);
  }
}

async function verify(storageKey, expectedSize, expectedChecksum) {
  const information = await stat(storageKey);
  if (information.size !== expectedSize) throw new OralAudioStorageError('AUDIO_INTEGRITY_FAILED', 'L’intégrité du fichier audio ne peut pas être confirmée.');
  const contents = await fs.readFile(information.absolutePath);
  const checksum = crypto.createHash('sha256').update(contents).digest('hex');
  if (checksum !== expectedChecksum) throw new OralAudioStorageError('AUDIO_INTEGRITY_FAILED', 'L’intégrité du fichier audio ne peut pas être confirmée.');
  return information;
}

async function remove(storageKey) {
  if (!storageKey) return;
  try { await fs.unlink(resolveStorageKey(storageKey)); } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'AUDIO_NOT_FOUND') throw error;
  }
}

async function removeTemporary(file) {
  if (!file?.path) return;
  try { await fs.unlink(file.path); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function cleanupTemporaryFiles(maxAgeMs = 24 * 60 * 60 * 1000) {
  await ensureDirectories();
  const entries = await fs.readdir(TEMP_ROOT, { withFileTypes: true });
  const threshold = Date.now() - maxAgeMs;
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const target = path.join(TEMP_ROOT, entry.name);
    const information = await fs.stat(target);
    if (information.mtimeMs < threshold) {
      await fs.unlink(target);
      removed += 1;
    }
  }
  return removed;
}

module.exports = {
  PRIVATE_ROOT,
  TEMP_ROOT,
  MAX_AUDIO_BYTES,
  SUPPORTED_AUDIO,
  OralAudioStorageError,
  ensureDirectories,
  inspectTemporaryFile,
  persistTemporaryFile,
  resolveStorageKey,
  stat,
  verify,
  remove,
  removeTemporary,
  cleanupTemporaryFiles,
};
