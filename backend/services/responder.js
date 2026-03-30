/**
 * IA Responder — Uses Groq (Llama 3) to generate intelligent commercial replies
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const Groq = require('groq-sdk');

let groq = null;
if (process.env.GROQ_API_KEY) {
  groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
}

/**
 * Draft a professional reply to a lead's email using Groq.
 * @param {Object} email - The original email from DB { from_name, from_email, subject, body }
 * @param {Object} config - Company config (to know keywords/industry)
 * @returns {String} The drafted reply text
 */
async function draftReply(email, config) {
  const prompt = `Tu es "L'équipe AutoFlow", une agence experte en automatisation.
Tu dois rédiger une réponse commerciale parfaite à ce prospect.

CONSIGNES STRICTES :
1. Vouvoiement OBLIGATOIRE. Sois professionnel et chaleureux.
2. Si le prospect demande un devis ou démo, propose un rdv la semaine prochaine.
3. Signe obligatoirement par : "Cordialement,\\n\\nL'équipe AutoFlow".
4. Tu dois retourner la réponse SOUS FORME DE JSON STRICTEMENT VALIDE.
5. Sois concis (max 150 mots).

Format JSON attendu (aucune autre balise markdown) :
{
  "subject": "Re: <votre suggestion d'objet ou l'original>",
  "body": "<corps de l'email avec les sauts de ligne \\n>"
}

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

Rédige maintenant la réponse pour ce prospect précis de manière directe et formate-la en JSON STRICTEMENT VALIDE :`;

  try {
    const chat = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: 'json_object' }
    });

    let raw = chat.choices[0]?.message?.content || '{}';
    // Clean markdown manually if it still injects it
    raw = raw.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
    const result = JSON.parse(raw);
    
    return {
      subject: result.subject || `Re: ${email.subject}`,
      body: result.body || result.texte || result.text || ''
    };
  } catch (err) {
    console.error('Responder error:', err.message);
    return {
      subject: `Re: ${email.subject || ''}`,
      body: `Bonjour ${email.from_name.split(' ')[0] || ''},\n\nMerci pour votre message. Nous l'avons bien reçu et reviendrons vers vous très rapidement pour vous apporter une réponse personnalisée.\n\nCordialement,\n\nL'équipe AutoFlow`
    };
  }
}

module.exports = { draftReply };
