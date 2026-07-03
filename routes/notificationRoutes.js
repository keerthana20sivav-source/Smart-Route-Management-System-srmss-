const express = require('express');
const router = express.Router();
const db = require('../db');

// Generate notifications — license expiry + maintenance due
router.get('/notifications/generate', (req, res) => {
  if (!req.session.user) return res.redirect('/');

  const today = new Date();
  const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Check driver license expiry (within 30 days)
  db.query(`SELECT * FROM drivers WHERE license_expiry <= ? AND license_expiry >= ?`,
    [in30Days, today], (err, drivers) => {
      drivers.forEach(d => {
        const daysLeft = Math.ceil((new Date(d.license_expiry) - today) / (1000 * 60 * 60 * 24));
        db.query(`INSERT INTO notifications (user_id, title, message, type)
                  SELECT ?, ?, ?, 'general'
                  WHERE NOT EXISTS (
                    SELECT 1 FROM notifications 
                    WHERE message LIKE ? AND DATE(created_at) = CURDATE()
                  )`,
          [req.session.user.user_id,
           `⚠️ License Expiring Soon!`,
           `Driver ${d.full_name}'s license expires in ${daysLeft} days (${new Date(d.license_expiry).toLocaleDateString()})!`,
           `%${d.full_name}%license%`
          ], () => {});
      });
    });

  // Check maintenance due (within 7 days)
  db.query(`SELECT m.*, b.registration_no FROM maintenance_logs m
            LEFT JOIN buses b ON m.bus_id = b.bus_id
            WHERE m.next_service_date <= ? AND m.next_service_date >= ?`,
    [in30Days, today], (err, logs) => {
      logs.forEach(m => {
        const daysLeft = Math.ceil((new Date(m.next_service_date) - today) / (1000 * 60 * 60 * 24));
        db.query(`INSERT INTO notifications (user_id, title, message, type)
                  SELECT ?, ?, ?, 'maintenance'
                  WHERE NOT EXISTS (
                    SELECT 1 FROM notifications 
                    WHERE message LIKE ? AND DATE(created_at) = CURDATE()
                  )`,
          [req.session.user.user_id,
           `🔧 Maintenance Due Soon!`,
           `Bus ${m.registration_no} is due for service in ${daysLeft} days (${new Date(m.next_service_date).toLocaleDateString()})!`,
           `%${m.registration_no}%service%`
          ], () => {});
      });
    });

  setTimeout(() => res.redirect('/dashboard'), 500);
});

// Get notifications
router.get('/notifications', (req, res) => {
  if (!req.session.user) return res.json([]);
  db.query(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
    [req.session.user.user_id], (err, notifications) => {
      res.json(notifications || []);
    });
});

// Mark all read
router.post('/notifications/read', (req, res) => {
  if (!req.session.user) return res.json({});
  db.query(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`,
    [req.session.user.user_id], () => {
      res.json({ success: true });
    });
});

// Unread count
router.get('/notifications/count', (req, res) => {
  if (!req.session.user) return res.json({ count: 0 });
  db.query(`SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`,
    [req.session.user.user_id], (err, result) => {
      res.json({ count: result[0].count });
    });
});

module.exports = router;