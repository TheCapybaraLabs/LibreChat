const express = require('express');
const { requireJwtAuth, checkAdmin } = require('~/server/middleware');
const { updateUser, getUserById } = require('~/models');

const router = express.Router();

router.use(requireJwtAuth);
router.use(checkAdmin);

/**
 * PATCH /admin/users/:id/tokens
 * Body: { total?: number, used?: number, blocked?: boolean }
 */
router.patch('/users/:id/tokens', async (req, res) => {
  try {
    const { id } = req.params;
    const { total, used, blocked } = req.body || {};

    // Validate input types if provided
    const update = {};
    if (total !== undefined) {
      if (typeof total !== 'number' || total < 0) {
        return res.status(400).json({ error: 'total must be a non-negative number' });
      }
      update['tokens.total'] = total;
    }
    if (used !== undefined) {
      if (typeof used !== 'number' || used < 0) {
        return res.status(400).json({ error: 'used must be a non-negative number' });
      }
      update['tokens.used'] = used;
    }
    if (blocked !== undefined) {
      if (typeof blocked !== 'boolean') {
        return res.status(400).json({ error: 'blocked must be a boolean' });
      }
      update['tokens.blocked'] = blocked;
    }

    // If both values provided and used reaches/exceeds total, auto-block unless explicitly overridden
    if (update['tokens.used'] !== undefined || update['tokens.total'] !== undefined) {
      const nextTotal =
        update['tokens.total'] !== undefined
          ? update['tokens.total']
          : (await getUserById(id))?.tokens?.total ?? 0;
      const nextUsed =
        update['tokens.used'] !== undefined
          ? update['tokens.used']
          : (await getUserById(id))?.tokens?.used ?? 0;
      if (blocked === undefined) {
        update['tokens.blocked'] = nextTotal > 0 && nextUsed >= nextTotal;
      }
    }

    const updated = await updateUser(id, update);
    if (!updated) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.status(200).json({
      _id: updated._id,
      email: updated.email,
      username: updated.username,
      tokens: updated.tokens,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
