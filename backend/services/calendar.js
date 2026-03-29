const { google } = require('googleapis');
const db = require('../db/database');

/**
 * Insert a calendar event into Google Calendar
 * @param {Number} companyId - the user's company ID
 * @param {Object} eventDetails - { title, start_time, end_time, lead_name, lead_email }
 */
async function insertCalendarEvent(companyId, eventDetails) {
  // Fetch oauth tokens for this company
  const company = db.prepare('SELECT gmail_tokens FROM companies WHERE id = ?').get(companyId);
  if (!company || !company.gmail_tokens) {
    throw new Error('Google n\'est pas connecté.');
  }

  const tokens = JSON.parse(company.gmail_tokens);

  // Authenticate
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials(tokens);

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const event = {
    summary: eventDetails.title || `RDV avec ${eventDetails.lead_name}`,
    description: `Généré par AutoFlow IA.\nContact: ${eventDetails.lead_email}`,
    start: {
      dateTime: eventDetails.start_time,
      timeZone: 'Europe/Paris', // Ideally configurable, hardcoded for MVP
    },
    end: {
      dateTime: eventDetails.end_time,
      timeZone: 'Europe/Paris',
    },
  };

  // Ensure attendees list exists if email is provided
  if (eventDetails.lead_email) {
    event.attendees = [{ email: eventDetails.lead_email }];
    // Optionally we could send Updates to 'all' to explicitly invite them via Google
  }

  try {
    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      sendUpdates: 'none', // Set to 'all' if we want Google to email the lead immediately
    });

    // Check if tokens were refreshed by the library and update DB if so!
    oauth2Client.on('tokens', (newTokens) => {
      if (newTokens.refresh_token) tokens.refresh_token = newTokens.refresh_token;
      tokens.access_token = newTokens.access_token;
      tokens.expiry_date = newTokens.expiry_date;
      db.prepare('UPDATE companies SET gmail_tokens = ? WHERE id = ?').run(JSON.stringify(tokens), companyId);
    });

    return response.data;
  } catch (err) {
    if (err.message && err.message.includes('insufficient permissions')) {
      throw new Error("Autorisations insuffisantes. Veuillez déconnecter et reconnecter Gmail depuis AutoFlow pour accepter l'accès au Calendrier.");
    }
    throw err;
  }
}

module.exports = {
  insertCalendarEvent
};
