#!/usr/bin/env node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');

const TEMPLATES_DIR = path.join(__dirname, '..', 'api', 'server', 'utils', 'emails');
const OUT_DIR = path.join(__dirname, '.email-previews');

const appName = process.env.APP_TITLE || 'LabsChat';
const supportEmail = process.env.EMAIL_SUPPORT || '';
const year = new Date().getFullYear();

const welcomeBase = {
  appName,
  name: 'Jane Doe',
  appUrl: 'https://chat.example.com',
  year,
};
const inviteBase = {
  appName,
  inviteLink: 'https://chat.example.com/invite?token=abc123',
  year,
};
const verifyBase = {
  appName,
  name: 'Jane Doe',
  verificationLink: 'https://chat.example.com/verify?token=abc123&email=x%40y.com',
  year,
};
const requestResetBase = {
  appName,
  name: 'Jane Doe',
  link: 'https://chat.example.com/reset-password?token=abc123&userId=xyz',
  year,
};
const passwordResetBase = { appName, name: 'Jane Doe', year };

const fixtures = [
  {
    template: 'welcomeEmail.handlebars',
    payload: { ...welcomeBase, password: 'TempPass-42!', supportEmail },
  },
  {
    template: 'welcomeEmail.handlebars',
    outputName: 'welcomeEmail-no-password.html',
    payload: { ...welcomeBase, supportEmail },
  },
  {
    template: 'welcomeEmail.handlebars',
    outputName: 'welcomeEmail-no-support.html',
    payload: { ...welcomeBase, password: 'TempPass-42!', supportEmail: '' },
  },
  {
    template: 'inviteUser.handlebars',
    payload: { ...inviteBase, supportEmail },
  },
  {
    template: 'inviteUser.handlebars',
    outputName: 'inviteUser-no-support.html',
    payload: { ...inviteBase, supportEmail: '' },
  },
  {
    template: 'verifyEmail.handlebars',
    payload: { ...verifyBase, supportEmail },
  },
  {
    template: 'verifyEmail.handlebars',
    outputName: 'verifyEmail-no-support.html',
    payload: { ...verifyBase, supportEmail: '' },
  },
  {
    template: 'requestPasswordReset.handlebars',
    payload: { ...requestResetBase, supportEmail },
  },
  {
    template: 'requestPasswordReset.handlebars',
    outputName: 'requestPasswordReset-no-support.html',
    payload: { ...requestResetBase, supportEmail: '' },
  },
  {
    template: 'passwordReset.handlebars',
    payload: { ...passwordResetBase, supportEmail },
  },
  {
    template: 'passwordReset.handlebars',
    outputName: 'passwordReset-no-support.html',
    payload: { ...passwordResetBase, supportEmail: '' },
  },
];

function render(template, payload) {
  const source = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf8');
  return handlebars.compile(source)(payload);
}

function buildIndex(entries) {
  const links = entries
    .map(
      ({ fileName, template }) =>
        `<li><a href="./${fileName}" target="preview" style="color:#10a37f;">${fileName}</a> <span style="color:#94a3b8;">(${template})</span></li>`,
    )
    .join('\n');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Email previews</title>
  <style>
    body { font-family: -apple-system, sans-serif; margin: 0; display: grid; grid-template-columns: 280px 1fr; height: 100vh; }
    nav { background: #f4f5f7; padding: 20px; border-right: 1px solid #eef0f3; overflow: auto; }
    nav h1 { font-size: 14px; margin: 0 0 12px 0; color: #0f172a; }
    nav ul { list-style: none; padding: 0; margin: 0; font-size: 13px; line-height: 1.8; }
    iframe { border: 0; width: 100%; height: 100vh; }
  </style>
</head>
<body>
  <nav>
    <h1>Email previews</h1>
    <ul>${links}</ul>
  </nav>
  <iframe name="preview" src="./${entries[0].fileName}"></iframe>
</body>
</html>`;
}

(function main() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }
  const entries = fixtures.map(({ template, payload, outputName }) => {
    const fileName = outputName || template.replace('.handlebars', '.html');
    const html = render(template, payload);
    fs.writeFileSync(path.join(OUT_DIR, fileName), html);
    return { fileName, template };
  });
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), buildIndex(entries));
  console.log(`Rendered ${entries.length} preview(s) to ${OUT_DIR}`);
  console.log(`Open: file://${path.join(OUT_DIR, 'index.html')}`);
})();
