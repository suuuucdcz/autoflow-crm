const express = require('express');
const db = require('../db/database');
const { insertCalendarEvent } = require('../services/calendar');

const router = express.Router({ mergeParams: true });

// GET /api/companies/:id/scheduler - List all meetings
router.get('/', (req, res) => {
  const companyId = req.params.id;
  try {
    const meetings = db.prepare(`
      SELECT m.*, l.name as lead_name, l.email as lead_email 
      FROM meetings m 
      LEFT JOIN leads l ON m.lead_id = l.id
      WHERE m.company_id = ?
      ORDER BY m.start_time ASC
    `).all(companyId);
    
    // Group into suggested vs confirmed
    const response = {
      suggested: meetings.filter(m => m.status === 'suggested'),
      confirmed: meetings.filter(m => m.status === 'confirmed'),
    };
    
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/companies/:id/scheduler/:meetingId/confirm
router.post('/:meetingId/confirm', async (req, res) => {
  const { meetingId, id: companyId } = req.params;
  
  try {
    const meeting = db.prepare(`
      SELECT m.*, l.name as lead_name, l.email as lead_email 
      FROM meetings m 
      LEFT JOIN leads l ON m.lead_id = l.id
      WHERE m.id = ? AND m.company_id = ?
    `).get(meetingId, companyId);
    
    if (!meeting) return res.status(404).json({ error: 'Meeting introuvable' });
    if (meeting.status !== 'suggested') return res.status(400).json({ error: 'Ce meeting a déjà été traité' });

    // Try creating it via Google Calendar
    try {
      const gcalResource = await insertCalendarEvent(companyId, {
        title: meeting.title,
        start_time: meeting.start_time,
        end_time: meeting.end_time,
        lead_name: meeting.lead_name,
        lead_email: meeting.lead_email
      });
      
      // Update DB
      db.prepare(`
        UPDATE meetings 
        SET status = 'confirmed', google_event_id = ?
        WHERE id = ?
      `).run(gcalResource.id, meetingId);
      
      db.prepare(`
        INSERT INTO activity_log (company_id, lead_id, action, detail) 
        VALUES (?, ?, 'meeting_confirmed', ?)
      `).run(companyId, meeting.lead_id, `Rendez-vous validé et ajouté à l'agenda (${meeting.start_time})`);

      res.json({ success: true, event: gcalResource });
    } catch (gcalErr) {
      console.error(gcalErr);
      res.status(403).json({ error: gcalErr.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/companies/:id/scheduler/:meetingId/reject
router.post('/:meetingId/reject', (req, res) => {
  const { meetingId, id: companyId } = req.params;
  try {
    const result = db.prepare(`
      UPDATE meetings SET status = 'dismissed' WHERE id = ? AND company_id = ?
    `).run(meetingId, companyId);
    
    if (result.changes === 0) return res.status(404).json({ error: 'Meeting introuvable' });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
