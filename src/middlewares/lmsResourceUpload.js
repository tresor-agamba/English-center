const path = require('path');
const os = require('os');
const multer = require('multer');

module.exports = multer({
  dest: path.join(os.tmpdir(), 'english-center-lms'),
  limits: { files: 1, fileSize: 20 * 1024 * 1024 },
}).single('resource');
