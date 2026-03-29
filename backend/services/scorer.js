/**
 * IA Scorer — Uses Groq (Llama 3) to qualify leads from emails
 * Adaptable per company via config (keywords, thresholds)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Score an email and classify it
 * @param {Object} email - { from_name, from_email, subject, body }
 * @param {Object} config - company config { keywords, hot_threshold, warm_threshold }
 * @returns {Object} { score: 0-100, tag: 'lead'|'support'|'spam', reason: string }
 */
async function scoreEmail(email, config) {
  const keywords = config.keywords || [];
  const currentDate = new Date().toISOString(); 
  const currentDay = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const prompt = `Tu es un assistant commercial expert en qualification de leads B2B. Aujoud'hui nous sommes le ${currentDay} (${currentDate}).

Analyse cet email et retourne un JSON avec exactement ces champs :
- "score": un entier de 0 à 100 indiquant la probabilité que l'email nécessite une action (commerciale ou pro)
- "tag": "lead" (opportunité, rdv, devis), "support" (bug, aide technique), ou "spam" (STRICTEMENT réservé aux pubs, newsletters, promotions, et robots)
- "reason": une courte explication en français (max 20 mots)
- "appointment_suggestion": si le prospect propose EXACTEMENT ou IMPLICITEMENT un rendez-vous (ex: "on s'appelle demain", "dispo mardi à 14h"), fournis un objet avec { "title": "Rendez-vous avec ${email.from_name}", "start_time": "YYYY-MM-DDTHH:MM:SS", "end_time": "YYYY-MM-DDTHH:MM:SS" (ajoute 30 minutes au start_time) }. Si aucune heure n'est trouvée (ex: "demain matin"), choisis arbitrairement une heure cohérente (ex: 10:00). S'il n'y a STRICTEMENT AUCUNE volonté de rdv, renvoie null pour ce champ.

Règles de qualification :
1. Score élevé (80-100) : Vrai prospect commercial, demande de rdv, devis, etc. ${keywords.length > 0 ? `Mots-clés : ${keywords.join(', ')}.` : ''}
2. Score moyen (30-79) : Échange "classique" humain, relance ou envoi de fichiers. L'email de votre ami contenant une vidéo rentre ici ! Taggez "lead".
3. Score très bas (0-20) et tag "spam" : UNIQUEMENT pour les newsletters (promos) ou robots (noreply).

Email à analyser :
---
De : ${email.from_name} <${email.from_email}>
Objet : ${email.subject}
Corps : ${email.body || email.snippet || '(Message vide)'}
---

Réponds UNIQUEMENT en JSON valide, sans markdown :`;

  try {
    const chat = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 150,
      response_format: { type: 'json_object' },
    });

    let raw = chat.choices[0]?.message?.content || '{}';
    // Clean potential markdown around the output despite json_object mode
    raw = raw.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
    const result = JSON.parse(raw);

    const parsedTag = (result.tag || '').toLowerCase();
    return {
      score: Math.min(100, Math.max(0, parseInt(result.score) || 0)),
      tag: ['lead', 'support', 'spam'].includes(parsedTag) ? parsedTag : 'lead',
      reason: result.reason || '',
      appointment_suggestion: result.appointment_suggestion || null,
    };
  } catch (err) {
    console.error('Scorer error:', err.message);
    // Fallback: keyword-based scoring
    return fallbackScore(email, config);
  }
}

/**
 * Fallback scorer when API is unavailable
 */
function fallbackScore(email, config) {
  const text = `${email.subject} ${email.body || email.snippet || ''}`.toLowerCase();
  const keywords = (config.keywords || []).map(k => k.toLowerCase());

  // Spam detection
  const spamWords = ['offre', 'promo', 'gratuit', '-50%', 'newsletter', 'unsubscribe', 'noreply'];
  if (spamWords.some(w => text.includes(w)) || (email.from_email || '').includes('noreply')) {
    return { score: 5, tag: 'spam', reason: 'Détecté comme spam (mots-clés)' };
  }

  // Support detection
  const supportWords = ['problème', 'erreur', 'bug', 'ne fonctionne', 'aide', 'support'];
  if (supportWords.some(w => text.includes(w))) {
    return { score: 15, tag: 'support', reason: 'Détecté comme demande support' };
  }

  // Lead scoring
  let score = 40;
  const matchedKeywords = keywords.filter(k => text.includes(k));
  score += matchedKeywords.length * 15;

  // Bonus for commercial intent
  if (text.includes('tarif') || text.includes('prix') || text.includes('devis')) score += 15;
  if (text.includes('démo') || text.includes('essai')) score += 15;
  if (text.includes('intéress')) score += 10;

  score = Math.min(100, score);

  return { score, tag: 'lead', reason: `Mots-clés trouvés: ${matchedKeywords.join(', ') || 'aucun'}` };
}

module.exports = { scoreEmail };
