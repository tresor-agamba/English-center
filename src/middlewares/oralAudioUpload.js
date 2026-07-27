const crypto = require('crypto');
const multer = require('multer');
const storage = require('../services/oralAudioStorageService');

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, callback) {
      storage.ensureDirectories().then(() => callback(null, storage.TEMP_ROOT), callback);
    },
    filename(req, file, callback) {
      callback(null, `${Date.now()}-${crypto.randomBytes(16).toString('hex')}.upload`);
    },
  }),
  limits: { fileSize: storage.MAX_AUDIO_BYTES, files: 1, fields: 10 },
});

function singleAudio(req, res, next) {
  upload.single('audio')(req, res, error => {
    if (!error) return next();
    const normalized = new storage.OralAudioStorageError(
      error.code === 'LIMIT_FILE_SIZE' ? 'AUDIO_TOO_LARGE' : 'AUDIO_UPLOAD_INVALID',
      error.code === 'LIMIT_FILE_SIZE'
        ? `Le fichier audio dépasse la limite de ${Math.floor(storage.MAX_AUDIO_BYTES / 1024 / 1024)} Mo.`
        : 'La requête d’envoi audio est invalide.',
    );
    return next(normalized);
  });
}

module.exports = { singleAudio };
