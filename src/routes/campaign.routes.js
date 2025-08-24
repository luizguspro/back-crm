const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaign.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware);

router.get('/', campaignController.getAll);
router.post('/', campaignController.create);
router.put('/:id', campaignController.update);
router.delete('/:id', campaignController.delete);

module.exports = router;