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
- "score": un entier de 0 à 100 indiquant la probabilité que l'email nécessite une action (commerciale ou pro)
- "tag": "lead" (pour les opportunités, envois de fichiers, devis, échanges humains), "support" (pour l'aide technique), ou "spam" (STRICTEMENT réservé aux pubs, newsletters, promotions, et robots)
- "reason": une courte explication en français (max 20 mots)

Règles de qualification :
1. Score élevé (80-100) : Vrai prospect commercial, demande de devis, de tarifs, de démo. ${keywords.length > 0 ? `Présence des mots-clés de l'entreprise : ${keywords.join(', ')}.` : ''}
2. Score moyen (30-79) : Échange professionnel "classique", humain, envoi de fichiers (design, maquette, contrat) sans demande explicite. L'email de votre ami contenant une vidéo "motion design" rentre ici ! Taggez-le "lead".
3. Score très bas (0-20) et tag "spam" : UNIQUEMENT pour les newsletters automatiques (promos, offres, -50%), les bots (noreply), ou les démarcheurs à froid agressifs.

Attention critique : Un email provenant d'un vrai nom humain avec un sujet professionnel (ex: "Autoflow motion design") mais un corps vide N'EST PAS UN SPAM ! C'est souvent un collègue qui envoie une pièce jointe ou un lien. Ne le tagguez pas en "spam" !

Email à analyser :
---
De : ${email.from_name} <${email.from_email}>
Objet : ${email.subject}
Corps : ${email.body || email.snippet || '(Message vide : présence très probable d\'une pièce jointe ou simple transfert)'}
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
