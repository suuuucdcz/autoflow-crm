/**
 * Microsoft Graph Auth — Device Code Flow
 * 
 * This script handles Outlook/Microsoft 365 authentication.
 * Run: npm run auth:outlook
 * 
 * It will:
 * 1. Show you a URL and a code
 * 2. You open the URL in your browser
 * 3. You enter the code and log in with your Microsoft account
 * 4. The tokens are saved to tokens.json for the email watcher to use
 * 
 * NO app registration needed — uses the public Microsoft app client.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const msal = require('@azure/msal-node');
const fs = require('fs');
const path = require('path');

const TOKENS_PATH = path.join(__dirname, '..', 'tokens.json');

// Microsoft public client (no Azure registration needed)
const msalConfig = {
  auth: {
    clientId: process.env.MS_CLIENT_ID || '14d82eec-204b-4c2f-b7e8-296a70dab67e', // Public client for dev
    authority: process.env.MS_AUTHORITY || 'https://login.microsoftonline.com/common',
  },
};

const scopes = ['https://graph.microsoft.com/Mail.Read', 'https://graph.microsoft.com/User.Read', 'offline_access'];

async function authenticate() {
  const pca = new msal.PublicClientApplication(msalConfig);

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  📧 Connexion Outlook — AutoFlow CRM         ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const deviceCodeRequest = {
    scopes,
    deviceCodeCallback: (response) => {
      console.log('┌──────────────────────────────────────────────┐');
      console.log('│  1. Ouvre ce lien dans ton navigateur :       │');
      console.log(`│  👉 ${response.verificationUri}`);
      console.log('│                                               │');
      console.log(`│  2. Entre ce code : ${response.userCode}                │`);
      console.log('│                                               │');
      console.log('│  3. Connecte-toi avec ton compte Microsoft    │');
      console.log('└──────────────────────────────────────────────┘');
      console.log('\n⏳ En attente de ta connexion...\n');
    },
  };

  try {
    const response = await pca.acquireTokenByDeviceCode(deviceCodeRequest);
    
    // Save tokens
    const tokenData = {
      accessToken: response.accessToken,
      refreshToken: response.account ? response.account.homeAccountId : null,
      expiresOn: response.expiresOn?.toISOString(),
      account: response.account,
      email: response.account?.username,
    };

    // Also save the MSAL cache for token refresh
    const cache = pca.getTokenCache().serialize();
    tokenData.msalCache = cache;

    fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokenData, null, 2));

    console.log('✅ Connexion réussie !');
    console.log(`📧 Compte : ${response.account?.username}`);
    console.log(`📁 Tokens sauvegardés dans : tokens.json`);
    console.log('\n👉 Tu peux maintenant relancer le serveur : npm start\n');

    // Update .env with the email
    if (response.account?.username) {
      const envPath = path.join(__dirname, '..', '.env');
      let env = fs.readFileSync(envPath, 'utf-8');
      env = env.replace(/IMAP_USER=.*/, `IMAP_USER=${response.account.username}`);
      // Add MS_EMAIL if not present
      if (!env.includes('MS_EMAIL=')) {
        env += `\n# Microsoft Graph (auto-configured)\nMS_EMAIL=${response.account.username}\n`;
      } else {
        env = env.replace(/MS_EMAIL=.*/, `MS_EMAIL=${response.account.username}`);
      }
      fs.writeFileSync(envPath, env);
    }

    return tokenData;
  } catch (err) {
    console.error('❌ Erreur de connexion :', err.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  authenticate();
}

module.exports = { authenticate, TOKENS_PATH, msalConfig, scopes };
