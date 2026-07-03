const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/maintenance', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query(`SELECT m.*, b.registration_no, u.full_name as recorded_by_name
            FROM maintenance_logs m
            LEFT JOIN buses b ON m.bus_id = b.bus_id
            LEFT JOIN users u ON m.recorded_by = u.user_id
            ORDER BY m.service_date DESC`, (err, logs) => {
    if (err) console.error(err);
    res.render('maintenance/list', { user: req.session.user, logs: logs || [], error: null });
  });
});

router.get('/maintenance/add', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query('SELECT * FROM buses WHERE status != "inactive"', (err, buses) => {
    res.render('maintenance/add', { user: req.session.user, buses: buses || [], error: null });
  });
});

router.post('/maintenance/add', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { bus_id, type, description, cost, service_date, next_service_date, status } = req.body;

  if (!bus_id || !type || !service_date) {
    return db.query('SELECT * FROM buses WHERE status != "inactive"', (err, buses) => {
      res.render('maintenance/add', {
        user: req.session.user, buses: buses || [],
        error: '❌ Please fill all required fields'
      });
    });
  }

  db.query(`INSERT INTO maintenance_logs 
            (bus_id, type, description, cost, service_date, next_service_date, recorded_by, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [bus_id, type, description||null, cost||0, service_date, next_service_date||null,
     req.session.user.user_id, status||'pending'],
    (err) => {
      if (err) {
        console.error(err);
        return db.query('SELECT * FROM buses WHERE status != "inactive"', (err2, buses) => {
          res.render('maintenance/add', {
            user: req.session.user, buses: buses || [],
            error: '❌ Failed to add maintenance record'
          });
        });
      }
      res.redirect('/maintenance');
    });
});

router.get('/maintenance/view/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query(`SELECT m.*, b.registration_no, b.model, b.fuel_type, b.seating_capacity,
            u.full_name as recorded_by_name
            FROM maintenance_logs m
            LEFT JOIN buses b ON m.bus_id = b.bus_id
            LEFT JOIN users u ON m.recorded_by = u.user_id
            WHERE m.maintenance_id = ?`, [req.params.id], (err, result) => {
    if (err || result.length === 0) return res.redirect('/maintenance');
    res.render('maintenance/view', {
      user: req.session.user,
      maintenance: result[0]
    });
  });
});

router.get('/maintenance/edit/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query(`SELECT m.*, b.registration_no, b.model
            FROM maintenance_logs m
            LEFT JOIN buses b ON m.bus_id = b.bus_id
            WHERE m.maintenance_id = ?`, [req.params.id], (err, results) => {
    if (err || results.length === 0) return res.redirect('/maintenance');
    db.query('SELECT * FROM buses WHERE status != "inactive"', (err, buses) => {
      res.render('maintenance/edit', {
        user: req.session.user,
        maintenance: results[0],
        buses: buses || [],
        error: null, success: null
      });
    });
  });
});

router.post('/maintenance/edit/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { bus_id, type, description, cost, service_date, next_service_date, status } = req.body;

  db.query(`UPDATE maintenance_logs 
            SET bus_id=?, type=?, description=?, cost=?, service_date=?, next_service_date=?, status=?
            WHERE maintenance_id=?`,
    [bus_id, type, description||null, cost||0, service_date, next_service_date||null,
     status||'pending', req.params.id],
    (err) => {
      if (err) {
        console.error(err);
        return db.query('SELECT * FROM buses WHERE status != "inactive"', (err2, buses) => {
          res.render('maintenance/edit', {
            user: req.session.user,
            maintenance: { maintenance_id: req.params.id },
            buses: buses || [],
            error: '❌ Failed to update', success: null
          });
        });
      }
      db.query(`SELECT m.*, b.registration_no, b.model FROM maintenance_logs m
                LEFT JOIN buses b ON m.bus_id = b.bus_id WHERE m.maintenance_id = ?`,
        [req.params.id], (err, results) => {
        db.query('SELECT * FROM buses WHERE status != "inactive"', (err2, buses) => {
          res.render('maintenance/edit', {
            user: req.session.user,
            maintenance: results[0] || { maintenance_id: req.params.id },
            buses: buses || [],
            error: null,
            success: '✅ Updated successfully!'
          });
        });
      });
    });
});

router.get('/maintenance/delete/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query('DELETE FROM maintenance_logs WHERE maintenance_id = ?', [req.params.id], (err) => {
    if (err) console.error(err);
    res.redirect('/maintenance');
  });
});

module.exports = router;