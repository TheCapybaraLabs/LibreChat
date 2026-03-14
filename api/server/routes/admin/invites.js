const express = require('express');
const { User } = require('~/db/models');
const { Token } = require('~/db/models');
const { sendEmail } = require('~/server/utils');
const { createInvite, listInvites } = require('~/models/inviteUser');
const middleware = require('~/server/middleware');

const router = express.Router();

router.use(middleware.requireJwtAuth, middleware.checkAdmin);

router.get('/', async (req, res) => {
  try {
    const invites = await listInvites();
    res.json(invites);
  } catch (error) {
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

  const token = await createInvite(email);
  if (token?.message) {
    return res.status(500).json({ message: token.message });
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
  } catch {
    // Email send failure is non-fatal — invite is still created
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
    res.status(500).json({ message: 'Failed to revoke invite' });
  }
});

module.exports = router;
