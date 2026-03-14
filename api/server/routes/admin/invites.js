const mongoose = require('mongoose');
const express = require('express');
const { logger, hashToken, getRandomValues } = require('@librechat/data-schemas');
const { User, Token } = require('~/db/models');
const { createToken } = require('~/models');
const { sendEmail } = require('~/server/utils');
const middleware = require('~/server/middleware');

const router = express.Router();

router.use(middleware.requireJwtAuth, middleware.checkAdmin);

const createInvite = async (email) => {
  const token = await getRandomValues(32);
  const hash = await hashToken(token);
  const fakeUserId = new mongoose.Types.ObjectId();

  await createToken({
    userId: fakeUserId,
    email,
    token: hash,
    type: 'invite',
    createdAt: Date.now(),
    expiresIn: 604800,
  });

  return encodeURIComponent(token);
};

router.get('/', async (req, res) => {
  try {
    const invites = await Token.find(
      { type: 'invite' },
      '_id email createdAt expiresAt',
    ).lean();
    res.json(invites);
  } catch (error) {
    logger.error('[admin/invites] list failed', error);
    res.status(500).json({ message: 'Failed to list invites' });
  }
});

router.post('/', async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ message: 'Invalid email address' });
  }

  const userExists = await User.findOne({ email });
  if (userExists) {
    return res.status(409).json({ message: 'User already exists' });
  }

  let token;
  try {
    token = await createInvite(email);
  } catch (error) {
    logger.error('[admin/invites] create failed', error);
    return res.status(500).json({ message: 'Failed to create invite' });
  }

  const appName = process.env.APP_TITLE || 'LibreChat';
  const inviteLink = `${process.env.DOMAIN_CLIENT}/register?token=${token}`;

  try {
    await sendEmail({
      email,
      subject: `Convite para participar do ${appName}!`,
      payload: { appName, inviteLink, year: new Date().getFullYear() },
      template: 'inviteUser.handlebars',
    });
  } catch (error) {
    logger.warn('[admin/invites] email failed (non-fatal)', error);
  }

  const invite = await Token.findOne({ email, type: 'invite' }, '_id email createdAt expiresAt')
    .sort({ createdAt: -1 })
    .lean();

  res.json({ success: true, email, expiresAt: invite?.expiresAt });
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Token.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Invite not found' });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('[admin/invites] delete failed', error);
    res.status(500).json({ message: 'Failed to revoke invite' });
  }
});

module.exports = router;
