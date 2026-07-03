const express = require('express');
const router = express.Router();
const db = require('../db');

// Buses List
router.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query('SELECT * FROM buses ORDER BY created_at DESC', (err, buses) => {
    res.render('buses/list', { user: req.session.user, buses });
  });
});

// Add Bus GET
router.get('/add', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.render('buses/add', { user: req.session.user, error: null });
});

// Add Bus POST — fuel_type added
router.post('/add', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { registration_no, model, seating_capacity, mileage_km, fuel_type, status } = req.body;
  db.query('INSERT INTO buses (registration_no, model, seating_capacity, mileage_km, fuel_type, status, current_location) VALUES (?,?,?,?,?,?,?)',
    [registration_no, model, seating_capacity, mileage_km||0, fuel_type||'diesel', status, 'Colombo'],
    (err) => {
      if (err) console.log(err);
      res.redirect('/buses');
    });
});

// Edit Bus GET
router.get('/edit/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query('SELECT * FROM buses WHERE bus_id = ?', [req.params.id], (err, result) => {
    res.render('buses/edit', { user: req.session.user, bus: result[0], error: null, success: null });
  });
});

// Edit Bus POST — fuel_type added
router.post('/edit/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { registration_no, model, seating_capacity, mileage_km, fuel_type, status } = req.body;
  db.query('UPDATE buses SET registration_no=?, model=?, seating_capacity=?, mileage_km=?, fuel_type=?, status=? WHERE bus_id=?',
    [registration_no, model, seating_capacity, mileage_km||0, fuel_type||'diesel', status, req.params.id],
    (err) => {
      res.redirect('/buses');
    });
});

// Delete Bus
router.get('/delete/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query('DELETE FROM buses WHERE bus_id = ?', [req.params.id], (err) => {
    res.redirect('/buses');
  });
});

//view route add 

router.get('/view/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query('SELECT * FROM buses WHERE bus_id = ?', [req.params.id], (err, busResult) => {
    if (err || busResult.length === 0) return res.redirect('/buses');
    
    db.query(`SELECT m.*, b.registration_no FROM maintenance_logs m
              LEFT JOIN buses b ON m.bus_id = b.bus_id
              WHERE m.bus_id = ?
              ORDER BY m.service_date DESC`, [req.params.id], (err, maintenance) => {

      db.query(`SELECT f.*, r.route_name FROM fuel_logs f
                LEFT JOIN routes r ON f.route_id = r.route_id
                WHERE f.bus_id = ?
                ORDER BY f.log_date DESC LIMIT 10`, [req.params.id], (err, fuelLogs) => {

        const totalFuel = fuelLogs.reduce((sum, f) => sum + parseFloat(f.liters || 0), 0);
        const totalFuelCost = fuelLogs.reduce((sum, f) => sum + parseFloat(f.cost || 0), 0);
        const totalMaintCost = maintenance.reduce((sum, m) => sum + parseFloat(m.cost || 0), 0);

        res.render('buses/view', {
          user: req.session.user,
          bus: busResult[0],
          maintenance: maintenance || [],
          fuelLogs: fuelLogs || [],
          totalFuel: totalFuel.toFixed(2),
          totalFuelCost: totalFuelCost.toFixed(2),
          totalMaintCost: totalMaintCost.toFixed(2)
        });
      });
    });
  });
});

module.exports = router;