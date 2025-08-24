const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contact.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const multer = require('multer');

const upload = multer({ dest: 'uploads/' });

router.use(authMiddleware);

router.get('/', contactController.getAll);
router.post('/', contactController.create);
router.put('/:id', contactController.update);
router.delete('/:id', contactController.delete);
router.post('/import', upload.single('file'), contactController.importCSV);
router.get('/export', contactController.export);

module.exports = router;