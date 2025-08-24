const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware);

router.get('/kpis', dashboardController.getKPIs);
router.get('/recent-activities', dashboardController.getRecentActivities);
router.get('/performance-data', dashboardController.getPerformanceData);
router.get('/channel-performance', dashboardController.getChannelPerformance);

module.exports = router;