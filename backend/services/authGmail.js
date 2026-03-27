/**
 * Google OAuth2 Auth — Local Redirect Flow
 *
 * Run: npm run auth:gmail
 *
 * 1. Opens your browser to Google's consent page
 * 2. You log in and authorize
 * 3. Google redirects to localhost:3001
 * 4. Tokens are saved to gmail_tokens.json
 *
 * First time: you need to create OAuth credentials:
 *   1. Go to https://console.cloud.google.com
 *   2. Create a project (or use existing)
 *   3. APIs & Services → Enable "Gmail API"
 *   4. APIs & Services → Credentials → Create Credentials → OAuth Client ID
 *   5. Application type: "Desktop app" (or "Web" with redirect http://localhost:3001/callback)
 *   6. Copy Client ID and Client Secret into your .env
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { google } = require('googleapis');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const TOKENS_PATH = path.join(__dirname, '..', 'gmail_tokens.json');
const REDIRECT_PORT = 3001;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
];

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(`
╔══════════════════════════════════════════════════════════╗
║  ❌ GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET manquants  ║
╚══════════════════════════════════════════════════════════╝

Pour les obtenir (5 minutes, gratuit) :

1. Va sur https://console.cloud.google.com
2. Crée un projet (ou utilise un existant)
3. Menu → APIs & Services → Library
4. Cherche "Gmail API" → Active-la
5. Menu → APIs & Services → Credentials
6. Bouton "+ Create Credentials" → "OAuth Client ID"
7. Type d'application : "Application de bureau" (Desktop app)
8. Copie le Client ID et Client Secret
9. Ajoute-les dans ton .env :

   GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxx

10. Relance: npm run auth:gmail
`);
    process.exit(1);
  }

  return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
}

async function authenticate() {
  const oauth2Client = getOAuth2Client();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  📧 Connexion Gmail — AutoFlow CRM           ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // Start local server to catch the OAuth callback
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
        if (url.pathname !== '/callback') {
          res.end('Attente du callback Google...');
          return;
        }

        const code = url.searchParams.get('code');
        if (!code) {
          res.end('❌ Pas de code reçu');
          reject(new Error('No code'));
          return;
        }

        // Exchange code for tokens
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Get user email
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        const profile = await gmail.users.getProfile({ userId: 'me' });
        const email = profile.data.emailAddress;

        // Save tokens
        const tokenData = {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          scope: tokens.scope,
          token_type: tokens.token_type,
          expiry_date: tokens.expiry_date,
          email: email,
        };
        fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokenData, null, 2));

        // Update .env
        const envPath = path.join(__dirname, '..', '.env');
        let env = fs.readFileSync(envPath, 'utf-8');
        if (!env.includes('GMAIL_EMAIL=')) {
          env += `\n# Gmail (auto-configured)\nGMAIL_EMAIL=${email}\n`;
        } else {
          env = env.replace(/GMAIL_EMAIL=.*/, `GMAIL_EMAIL=${email}`);
        }
        fs.writeFileSync(envPath, env);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <html><body style="font-family:system-ui;text-align:center;padding:60px">
            <h1>✅ Connexion réussie !</h1>
            <p>Compte : <strong>${email}</strong></p>
            <p>Tu peux fermer cette page et relancer le serveur.</p>
          </body></html>
        `);

        console.log(`\n✅ Connexion réussie !`);
        console.log(`📧 Compte : ${email}`);
        console.log(`📁 Tokens sauvegardés : gmail_tokens.json`);
        console.log(`\n👉 Relance le serveur : npm start\n`);

        server.close();
        resolve(tokenData);
      } catch (err) {
        res.end('❌ Erreur: ' + err.message);
        reject(err);
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`🌐 Serveur d'auth démarré sur le port ${REDIRECT_PORT}`);
      console.log(`\n👉 Ouvre ce lien dans ton navigateur :\n`);
      console.log(`   ${authUrl}\n`);
      console.log('⏳ En attente de ta connexion...\n');

      // Try to open browser automatically
      import('open').then(open => open.default(authUrl)).catch(() => {});
    });
  });
}

// Run if called directly
if (require.main === module) {
  authenticate().catch(err => {
    console.error('❌ Erreur:', err.message);
    process.exit(1);
  });
}

module.exports = { getOAuth2Client, TOKENS_PATH, SCOPES };
