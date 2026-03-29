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
  const prompt = `Tu es un assistant commercial expert en qualification de leads B2B.

Analyse cet email et retourne un JSON avec exactement ces champs :
- "score": un entier de 0 à 100 indiquant la probabilité que cette personne devienne client
- "tag": "lead" si c'est une opportunité commerciale, "support" si c'est du support technique, "spam" si c'est du spam/newsletter
- "reason": une courte explication en français (max 20 mots)

Critères de scoring élevé (80-100) :
${keywords.length > 0 ? `- Mention de mots-clés prioritaires : ${keywords.join(', ')}` : ''}
- Demande de démo, de tarifs, ou d'informations commerciales
- Entreprise identifiable (nom de société dans la signature)
- Ton professionnel, besoin exprimé clairement

Critères de scoring bas (0-30) :
- Spam, newsletter, promotion
- Pas de lien avec les services d'automatisation
- Email générique sans contexte

Email à analyser :
---
De : ${email.from_name} <${email.from_email}>
Objet : ${email.subject}
Corps : ${email.body || email.snippet || ''}
---

Réponds UNIQUEMENT en JSON valide, sans markdown, sans explication :`;

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
