const express = require('express');
const router = express.Router();
const pipelineController = require('../controllers/pipeline.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware);

router.get('/deals', pipelineController.getDeals);
router.post('/deals', pipelineController.createDeal);
router.put('/deals/:id/move', pipelineController.moveDeal);
router.put('/deals/:id', pipelineController.updateDeal);
router.delete('/deals/:id', pipelineController.deleteDeal);

module.exports = router;