const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const blurryClient = require('~/server/utils/blurryClient');

const router = express.Router();

router.use(requireJwtAuth);

router.get('/health', async (req, res) => {
  const result = await blurryClient.checkHealth();
  const httpStatus = result.status === 'ok' ? 200 : result.status === 'degraded' ? 503 : 503;
  res.status(httpStatus).json(result);
});

module.exports = router;
