/**
 * IA Responder — Uses Groq (Llama 3) to generate intelligent commercial replies
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Draft a professional reply to a lead's email using Groq.
 * @param {Object} email - The original email from DB { from_name, from_email, subject, body }
 * @param {Object} config - Company config (to know keywords/industry)
 * @returns {String} The drafted reply text
 */
async function draftReply(email, config) {
  const prompt = `Tu es "L'équipe AutoFlow", une agence experte en automatisation de processus métier (CRM, IA, Zapier, Make).
Tu dois rédiger une réponse commerciale par e-mail parfaite à un prospect B2B qui a envoyé le message suivant.

CONSIGNES STRICTES :
1. Vouvoiement OBLIGATOIRE. Sois professionnel, chaleureux et clair.
2. Si le prospect demande un devis, une démo ou des tarifs, propose-lui un rendez-vous téléphonique ou visio la semaine prochaine.
3. Ne fais QUE rédiger le corps de l'e-mail et la signature. 
4. Signe l'e-mail par : "Cordialement,\\n\\nL'équipe AutoFlow"
5. N'inclut PAS d'objet d'e-mail (le sujet), ne mets PAS de guillemets autour de l'e-mail, ne mets PAS de balises comme "Corps de l'e-mail :". Écris directement le texte.
6. Ne simule pas d'adresse e-mail ou de numéro de téléphone fictif dans la signature.
7. Reste concis (100 à 150 mots maximum). L'objectif est d'engager, pas de noyer le prospect.

E-mail reçu du prospect :
---
De : ${email.from_name} <${email.from_email}>
Objet : ${email.subject}
Message :
${email.body || email.snippet}
---

Exemple de réponse attendue:
Bonjour [Nom],

Merci pour votre message et pour l'intérêt que vous portez à nos solutions d'automatisation.
Nous serions ravis de discuter de vos besoins concernant [Sujet] et de vous présenter une courte démonstration.

Seriez-vous disponible pour un appel de 15 minutes mardi prochain ?

Cordialement,

L'équipe AutoFlow

Rédige maintenant la réponse pour ce prospect précis de manière directe :`;

  try {
    const chat = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.4, // Slight variation to sound natural
      max_tokens: 300,
    });

    let draft = chat.choices[0]?.message?.content || '';
    return draft.trim();
  } catch (err) {
    console.error('Responder error:', err.message);
    return `Bonjour ${email.from_name.split(' ')[0] || ''},\n\nMerci pour votre message. Nous l'avons bien reçu et reviendrons vers vous très rapidement pour vous apporter une réponse personnalisée.\n\nCordialement,\n\nL'équipe AutoFlow`;
  }
}

module.exports = { draftReply };
