const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/drivers', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query('SELECT * FROM drivers ORDER BY created_at DESC', (err, drivers) => {
    res.render('drivers/list', { user: req.session.user, drivers });
  });
});

router.get('/drivers/add', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.render('drivers/add', { user: req.session.user, error: null });
});

router.post('/drivers/add', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { full_name, phone, license_no, license_issue_date, license_expiry, working_hours, status } = req.body;
  db.query('INSERT INTO drivers (full_name, phone, license_no, license_issue_date, license_expiry, working_hours, status, current_location) VALUES (?,?,?,?,?,?,?,?)',
    [full_name, phone, license_no, license_issue_date||null, license_expiry, working_hours||0, status, 'Colombo'],
    (err) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.render('drivers/add', { user: req.session.user, error: '⚠️ License No already exists!' });
        }
        console.log(err);
      }
      res.redirect('/drivers');
    });
});

// Driver View — Assigned Routes
router.get('/drivers/view/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const driverId = req.params.id;

  db.query('SELECT * FROM drivers WHERE driver_id = ?', [driverId], (err, driverResult) => {
    if (err || driverResult.length === 0) return res.redirect('/drivers');
    const driver = driverResult[0];

    db.query(`SELECT s.*, r.route_name, r.start_point, r.end_point, r.distance_km, b.registration_no
              FROM schedules s
              LEFT JOIN routes r ON s.route_id = r.route_id
              LEFT JOIN buses b ON s.bus_id = b.bus_id
              WHERE s.driver_id = ?
              ORDER BY s.departure_time DESC`, [driverId], (err, schedules) => {

      db.query(`SELECT 
                SUM(TIMESTAMPDIFF(HOUR, departure_time, arrival_time)) as total_hours,
                COUNT(*) as total_trips
                FROM schedules
                WHERE driver_id = ? AND status != 'cancelled'
                AND MONTH(departure_time) = MONTH(CURDATE())`,
        [driverId], (err, statsResult) => {

        res.render('drivers/view', {
          user: req.session.user,
          driver,
          schedules: schedules || [],
          stats: statsResult ? statsResult[0] : {}
        });
      });
    });
  });
});

router.get('/drivers/edit/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query('SELECT * FROM drivers WHERE driver_id = ?', [req.params.id], (err, result) => {
    res.render('drivers/edit', { user: req.session.user, driver: result[0], error: null });
  });
});

router.post('/drivers/edit/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { full_name, phone, license_no, license_issue_date, license_expiry, working_hours, status, current_location } = req.body;
  db.query('UPDATE drivers SET full_name=?, phone=?, license_no=?, license_issue_date=?, license_expiry=?, working_hours=?, status=?, current_location=? WHERE driver_id=?',
    [full_name, phone, license_no, license_issue_date||null, license_expiry, working_hours||0, status, current_location||'Colombo', req.params.id],
    (err) => {
      res.redirect('/drivers');
    });
});

router.get('/drivers/delete/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query('DELETE FROM drivers WHERE driver_id = ?', [req.params.id], (err) => {
    res.redirect('/drivers');
  });
});

module.exports = router;