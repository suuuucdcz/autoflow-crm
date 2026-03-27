# AutoFlow CRM Dashboard

Plateforme CRM avec qualification IA des leads, pipeline Kanban et surveillance email automatisée.

## Stack

| Composant | Techno |
|---|---|
| Frontend | HTML / CSS / JS (vanilla) |
| Backend | Node.js + Express |
| Base de données | SQLite (better-sqlite3) |
| IA Scoring | Groq API (Llama 3.3 70B) |
| Email | Gmail API (Google OAuth2) |
| Notifications | Slack Webhooks + Nodemailer |

## Structure

```
├── index.html          # Dashboard frontend
├── style.css           # Styles (Apple-inspired)
├── script.js           # Frontend JS + API layer
└── backend/
    ├── server.js       # Express API server
    ├── .env            # Config (à créer)
    ├── db/
    │   ├── database.js # SQLite schema
    │   └── seed.js     # Données de démo
    ├── routes/
    │   ├── companies.js
    │   ├── emails.js
    │   ├── leads.js
    │   └── activity.js
    └── services/
        ├── scorer.js       # IA scoring (Groq)
        ├── gmailWatcher.js # Gmail polling
        ├── authGmail.js    # Google OAuth2
        └── notifier.js     # Slack + Email
```

## Installation

```bash
# 1. Cloner le repo
git clone https://github.com/suuuucdcz/autoflow-crm.git
cd autoflow-crm

# 2. Installer les dépendances
cd backend
npm install

# 3. Configurer l'environnement
cp .env.example .env
# Éditer .env avec tes clés API

# 4. Peupler la base de démo (optionnel)
npm run seed

# 5. Connecter Gmail
npm run auth:gmail

# 6. Lancer le serveur
npm start
```

Puis ouvrir `http://localhost:3000`

## Configuration (.env)

```env
GROQ_API_KEY=            # Clé API Groq pour le scoring IA
PORT=3000
GOOGLE_CLIENT_ID=        # OAuth2 Google (console.cloud.google.com)
GOOGLE_CLIENT_SECRET=
SLACK_WEBHOOK_URL=       # Optionnel
SMTP_HOST=               # Optionnel
SMTP_USER=
SMTP_PASS=
```

## API Endpoints

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/companies/:id` | Config entreprise |
| PUT | `/api/companies/:id/config` | Modifier config |
| GET | `/api/companies/:id/emails` | Liste des emails |
| GET | `/api/companies/:id/leads` | Liste des leads |
| PUT | `/api/companies/:id/leads/:id` | Modifier un lead |
| GET | `/api/companies/:id/kpi` | Statistiques |
| POST | `/api/test-score` | Tester le scoring IA |

## Licence

Propriétaire — AutoFlow
