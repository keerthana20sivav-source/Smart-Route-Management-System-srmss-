const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/schedules', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query(`SELECT s.*, r.route_name, b.registration_no, d.full_name as driver_name,
            (SELECT t.status FROM trips t WHERE t.schedule_id = s.schedule_id 
             ORDER BY t.created_at DESC LIMIT 1) as last_trip_status
            FROM schedules s
            LEFT JOIN routes r ON s.route_id = r.route_id
            LEFT JOIN buses b ON s.bus_id = b.bus_id
            LEFT JOIN drivers d ON s.driver_id = d.driver_id
            ORDER BY s.departure_time DESC`, (err, schedules) => {
    res.render('schedules/list', { user: req.session.user, schedules });
  });
});

router.get('/schedules/resolve/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query("UPDATE schedules SET status='scheduled' WHERE schedule_id = ?", [req.params.id], (err) => {
    res.redirect('/schedules');
  });
});

router.get('/schedules/clear-emergency', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query("UPDATE schedules SET status='scheduled' WHERE status='emergency'", (err) => {
    res.redirect('/schedules');
  });
});

router.get('/schedules/add', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query('SELECT * FROM routes WHERE status="active"', (err, routes) => {
    db.query('SELECT * FROM buses', (err, buses) => {
      db.query('SELECT * FROM drivers', (err, drivers) => {
        res.render('schedules/add', { user: req.session.user, routes, buses, drivers, error: null });
      });
    });
  });
});

router.get('/schedules/available/:route_id', (req, res) => {
  const routeId = req.params.route_id;
  db.query('SELECT start_point FROM routes WHERE route_id = ?', [routeId], (err, routeResult) => {
    if (err || routeResult.length === 0) return res.json({ buses: [], drivers: [], start_point: '' });
    const startPoint = routeResult[0].start_point;
    const city = startPoint.split(' ')[0];
    db.query('SELECT * FROM buses WHERE status != "maintenance"', (err, buses) => {
      db.query('SELECT * FROM drivers WHERE status != "off"', (err, drivers) => {
        res.json({ buses, drivers, start_point: startPoint, city });
      });
    });
  });
});

// ===== Maintenance Only Check (no time needed) =====
router.get('/schedules/check-maintenance', (req, res) => {
  const { bus_id } = req.query;
  if (!bus_id) return res.json({ status: 'ok', messages: [] });

  db.query(`SELECT b.registration_no, b.status,
            m.type, m.status as maint_status
            FROM buses b
            LEFT JOIN maintenance_logs m ON b.bus_id = m.bus_id
            AND m.status IN ('pending', 'in_progress')
            WHERE b.bus_id = ?
            ORDER BY m.maintenance_id DESC LIMIT 1`,
    [bus_id], (err, rows) => {
      if (err || rows.length === 0) return res.json({ status: 'ok', messages: [] });
      const bus = rows[0];
      let result = { status: 'ok', messages: [] };
      if (bus.status === 'maintenance') {
        result.status = 'block';
        result.messages.push(`⛔ Bus "${bus.registration_no}" is under MAINTENANCE! Cannot assign.`);
      } else if (bus.maint_status === 'in_progress') {
        result.status = 'warning';
        result.messages.push(`⚠️ Bus "${bus.registration_no}" has IN-PROGRESS maintenance (${bus.type||'service'})! Assign carefully.`);
      } else if (bus.maint_status === 'pending') {
        result.status = 'warning';
        result.messages.push(`⚠️ Bus "${bus.registration_no}" has PENDING maintenance. Consider completing it first!`);
      }
      res.json(result);
    });
});

// ===== Full Conflict Check =====
router.get('/schedules/check-conflict', (req, res) => {
  const { bus_id, driver_id, route_id, departure, arrival } = req.query;
  if (!departure || !arrival) return res.json({ status: 'ok', messages: [] });

  const departureMs = new Date(departure).getTime();
  const arrivalMs = new Date(arrival).getTime();
  const tripDurationHrs = (arrivalMs - departureMs) / (1000 * 60 * 60);

  let results = { status: 'ok', messages: [] };
  let tasks = [];

  if (bus_id) {
    tasks.push(new Promise((resolve) => {
      db.query(`SELECT s.*, b.registration_no as name FROM schedules s
                LEFT JOIN buses b ON s.bus_id = b.bus_id
                WHERE s.bus_id = ? AND s.status != 'cancelled'
                AND (departure_time < ? AND arrival_time > ?)`,
        [bus_id, arrival, departure], (err, rows) => {
          if (!err && rows.length > 0) {
            results.status = 'block';
            results.messages.push(`⛔ Check 1 — Bus "${rows[0].name}" already scheduled at this time!`);
          }
          resolve();
        });
    }));

    tasks.push(new Promise((resolve) => {
      db.query(`SELECT s.*, b.registration_no as name FROM schedules s
                LEFT JOIN buses b ON s.bus_id = b.bus_id
                WHERE s.bus_id = ? AND s.status != 'cancelled'
                AND arrival_time <= ? ORDER BY arrival_time DESC LIMIT 1`,
        [bus_id, departure], (err, rows) => {
          if (!err && rows.length > 0) {
            const gapMs = departureMs - new Date(rows[0].arrival_time).getTime();
            const gapHours = gapMs / (1000 * 60 * 60);
            const gapMins = Math.round(gapMs / (1000 * 60));
            if (gapHours < 1) {
              results.status = 'block';
              results.messages.push(`⛔ Check 3 — Bus "${rows[0].name}" needs 1hr rest! Gap: ${gapMins} mins only.`);
            } else if (gapHours <= 2) {
              if (results.status !== 'block') results.status = 'warning';
              results.messages.push(`⚠️ Check 3 — Bus "${rows[0].name}" minimum rest (${gapMins} mins).`);
            }
          }
          resolve();
        });
    }));

    tasks.push(new Promise((resolve) => {
      db.query(`SELECT b.registration_no, b.status,
                m.type, m.status as maint_status
                FROM buses b
                LEFT JOIN maintenance_logs m ON b.bus_id = m.bus_id
                AND m.status IN ('pending', 'in_progress')
                WHERE b.bus_id = ?
                ORDER BY m.maintenance_id DESC LIMIT 1`,
        [bus_id], (err, rows) => {
          if (!err && rows.length > 0) {
            const bus = rows[0];
            if (bus.status === 'maintenance') {
              results.status = 'block';
              results.messages.push(`⛔ Check 7 — Bus "${bus.registration_no}" is under MAINTENANCE! Cannot assign.`);
            } else if (bus.maint_status === 'in_progress') {
              if (results.status !== 'block') results.status = 'warning';
              results.messages.push(`⚠️ Check 7 — Bus "${bus.registration_no}" has IN-PROGRESS maintenance (${bus.type||'service'})!`);
            } else if (bus.maint_status === 'pending') {
              if (results.status !== 'block') results.status = 'warning';
              results.messages.push(`⚠️ Check 7 — Bus "${bus.registration_no}" has PENDING maintenance!`);
            }
          }
          resolve();
        });
    }));
  }

  if (driver_id) {
    tasks.push(new Promise((resolve) => {
      db.query(`SELECT s.*, d.full_name as name FROM schedules s
                LEFT JOIN drivers d ON s.driver_id = d.driver_id
                WHERE s.driver_id = ? AND s.status != 'cancelled'
                AND (departure_time < ? AND arrival_time > ?)`,
        [driver_id, arrival, departure], (err, rows) => {
          if (!err && rows.length > 0) {
            results.status = 'block';
            results.messages.push(`⛔ Check 2 — Driver "${rows[0].name}" already scheduled at this time!`);
          }
          resolve();
        });
    }));

    tasks.push(new Promise((resolve) => {
      db.query(`SELECT s.*, d.full_name as name FROM schedules s
                LEFT JOIN drivers d ON s.driver_id = d.driver_id
                WHERE s.driver_id = ? AND s.status != 'cancelled'
                AND arrival_time <= ? ORDER BY arrival_time DESC LIMIT 1`,
        [driver_id, departure], (err, rows) => {
          if (!err && rows.length > 0) {
            const gapMs = departureMs - new Date(rows[0].arrival_time).getTime();
            const gapHours = gapMs / (1000 * 60 * 60);
            const gapMins = Math.round(gapMs / (1000 * 60));
            if (gapHours < 1) {
              results.status = 'block';
              results.messages.push(`⛔ Check 3 — Driver "${rows[0].name}" needs 1hr rest! Gap: ${gapMins} mins only.`);
            } else if (gapHours <= 2) {
              if (results.status !== 'block') results.status = 'warning';
              results.messages.push(`⚠️ Check 3 — Driver "${rows[0].name}" minimum rest (${gapMins} mins).`);
            }
          }
          resolve();
        });
    }));

    tasks.push(new Promise((resolve) => {
      db.query('SELECT full_name, license_expiry FROM drivers WHERE driver_id = ?', [driver_id], (err, rows) => {
        if (!err && rows.length > 0) {
          const expiry = new Date(rows[0].license_expiry);
          const today = new Date();
          if (expiry < today) {
            results.status = 'block';
            results.messages.push(`⛔ Check 4 — Driver "${rows[0].full_name}" license EXPIRED! Cannot assign.`);
          } else {
            const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
            if (daysLeft <= 30) {
              if (results.status !== 'block') results.status = 'warning';
              results.messages.push(`⚠️ Check 4 — Driver "${rows[0].full_name}" license expires in ${daysLeft} days!`);
            }
          }
        }
        resolve();
      });
    }));

    tasks.push(new Promise((resolve) => {
      const depDate = new Date(departure).toISOString().split('T')[0];
      db.query(`SELECT SUM(TIMESTAMPDIFF(MINUTE, departure_time, arrival_time)) as total_mins,
                d.full_name as name FROM schedules s
                LEFT JOIN drivers d ON s.driver_id = d.driver_id
                WHERE s.driver_id = ? AND s.status != 'cancelled' AND DATE(departure_time) = ?`,
        [driver_id, depDate], (err, rows) => {
          if (!err && rows[0] && rows[0].total_mins) {
            const totalHrs = rows[0].total_mins / 60;
            const totalAfter = totalHrs + tripDurationHrs;
            if (totalAfter > 8) {
              results.status = 'block';
              results.messages.push(`⛔ Check 5 — Driver "${rows[0].name}" will exceed 8hr limit! Total: ${totalAfter.toFixed(1)}hrs.`);
            } else if (totalAfter > 6) {
              if (results.status !== 'block') results.status = 'warning';
              results.messages.push(`⚠️ Check 5 — Driver "${rows[0].name}" will work ${totalAfter.toFixed(1)}hrs today.`);
            }
          }
          resolve();
        });
    }));
  }

  if (route_id) {
    tasks.push(new Promise((resolve) => {
      db.query(`SELECT s.*, r.route_name FROM schedules s
                LEFT JOIN routes r ON s.route_id = r.route_id
                WHERE s.route_id = ? AND s.status != 'cancelled'
                AND (departure_time < ? AND arrival_time > ?)`,
        [route_id, arrival, departure], (err, rows) => {
          if (!err && rows.length > 0) {
            if (results.status !== 'block') results.status = 'warning';
            results.messages.push(`⚠️ Check 4 — Route "${rows[0].route_name}" already has a schedule at this time!`);
          }
          resolve();
        });
    }));
  }

  if (bus_id && route_id) {
    tasks.push(new Promise((resolve) => {
      db.query('SELECT current_location, registration_no FROM buses WHERE bus_id = ?',
        [bus_id], (err, busRows) => {
          if (!err && busRows.length > 0) {
            db.query('SELECT start_point FROM routes WHERE route_id = ?', [route_id], (err, routeRows) => {
              if (!err && routeRows.length > 0) {
                const busLoc = busRows[0].current_location.split(' ')[0].toLowerCase();
                const routeStart = routeRows[0].start_point.split(' ')[0].toLowerCase();
                if (busLoc !== routeStart) {
                  results.status = 'block';
                  results.messages.push(`⛔ Check 6 — Bus "${busRows[0].registration_no}" is at "${busRows[0].current_location}" but route starts at "${routeRows[0].start_point}"!`);
                }
              }
              resolve();
            });
          } else resolve();
        });
    }));
  }

  if (driver_id && route_id) {
    tasks.push(new Promise((resolve) => {
      db.query('SELECT current_location, full_name FROM drivers WHERE driver_id = ?',
        [driver_id], (err, driverRows) => {
          if (!err && driverRows.length > 0) {
            db.query('SELECT start_point FROM routes WHERE route_id = ?', [route_id], (err, routeRows) => {
              if (!err && routeRows.length > 0) {
                const driverLoc = driverRows[0].current_location.split(' ')[0].toLowerCase();
                const routeStart = routeRows[0].start_point.split(' ')[0].toLowerCase();
                if (driverLoc !== routeStart) {
                  results.status = 'block';
                  results.messages.push(`⛔ Check 6 — Driver "${driverRows[0].full_name}" is at "${driverRows[0].current_location}" but route starts at "${routeRows[0].start_point}"!`);
                }
              }
              resolve();
            });
          } else resolve();
        });
    }));
  }

  Promise.all(tasks).then(() => res.json(results));
});

// ===== Trip Status Routes =====
router.get('/schedules/trip/ontime/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query(`INSERT INTO trips (schedule_id, actual_departure, status) 
            SELECT schedule_id, departure_time, 'on_time' FROM schedules WHERE schedule_id = ?`,
    [req.params.id], (err) => { if (err) console.log(err); res.redirect('/schedules'); });
});

router.get('/schedules/trip/delayed/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query(`INSERT INTO trips (schedule_id, actual_departure, status) 
            SELECT schedule_id, departure_time, 'delayed' FROM schedules WHERE schedule_id = ?`,
    [req.params.id], (err) => { if (err) console.log(err); res.redirect('/schedules'); });
});

router.get('/schedules/trip/completed/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query(`INSERT INTO trips (schedule_id, actual_departure, status) 
            SELECT schedule_id, departure_time, 'completed' FROM schedules WHERE schedule_id = ?`,
    [req.params.id], (err) => { if (err) console.log(err); res.redirect('/schedules'); });
});

router.get('/schedules/trip/cancelled/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query(`INSERT INTO trips (schedule_id, actual_departure, status) 
            SELECT schedule_id, departure_time, 'cancelled' FROM schedules WHERE schedule_id = ?`,
    [req.params.id], (err) => { if (err) console.log(err); res.redirect('/schedules'); });
});

router.post('/schedules/add', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { route_id, bus_id, driver_id, departure_time, arrival_time, schedule_type, status } = req.body;

  const departureMs = new Date(departure_time).getTime();
  const arrivalMs = new Date(arrival_time).getTime();
  const tripDurationHrs = (arrivalMs - departureMs) / (1000 * 60 * 60);

  const blockChecks = [];

  if (bus_id) {
    blockChecks.push(new Promise((resolve) => {
      db.query('SELECT registration_no, status FROM buses WHERE bus_id = ?', [bus_id], (err, rows) => {
        if (!err && rows && rows.length > 0 && rows[0].status === 'maintenance') {
          resolve(`⛔ Bus "${rows[0].registration_no}" is under MAINTENANCE! Cannot assign.`);
        } else resolve(null);
      });
    }));

    blockChecks.push(new Promise((resolve) => {
      db.query(`SELECT * FROM schedules WHERE bus_id = ? AND status != 'cancelled'
                AND (departure_time < ? AND arrival_time > ?)`,
        [bus_id, arrival_time, departure_time], (err, rows) => {
          resolve(rows && rows.length > 0 ? `⛔ Bus conflict at this time!` : null);
        });
    }));

    blockChecks.push(new Promise((resolve) => {
      db.query(`SELECT s.*, b.registration_no as name FROM schedules s
                LEFT JOIN buses b ON s.bus_id = b.bus_id
                WHERE s.bus_id = ? AND s.status != 'cancelled'
                AND arrival_time <= ? ORDER BY arrival_time DESC LIMIT 1`,
        [bus_id, departure_time], (err, rows) => {
          if (!err && rows && rows.length > 0) {
            const gapMs = departureMs - new Date(rows[0].arrival_time).getTime();
            if (gapMs / (1000 * 60 * 60) < 1) {
              resolve(`⛔ Bus "${rows[0].name}" needs 1hr rest! Gap: ${Math.round(gapMs/60000)} mins.`);
            } else resolve(null);
          } else resolve(null);
        });
    }));
  }

  if (driver_id) {
    blockChecks.push(new Promise((resolve) => {
      db.query('SELECT full_name, license_expiry FROM drivers WHERE driver_id = ?', [driver_id], (err, rows) => {
        if (!err && rows && rows.length > 0) {
          const expiry = new Date(rows[0].license_expiry);
          if (expiry < new Date()) {
            resolve(`⛔ Driver "${rows[0].full_name}" license EXPIRED! Cannot assign.`);
          } else resolve(null);
        } else resolve(null);
      });
    }));

    blockChecks.push(new Promise((resolve) => {
      db.query(`SELECT * FROM schedules WHERE driver_id = ? AND status != 'cancelled'
                AND (departure_time < ? AND arrival_time > ?)`,
        [driver_id, arrival_time, departure_time], (err, rows) => {
          resolve(rows && rows.length > 0 ? `⛔ Driver conflict at this time!` : null);
        });
    }));

    blockChecks.push(new Promise((resolve) => {
      db.query(`SELECT s.*, d.full_name as name FROM schedules s
                LEFT JOIN drivers d ON s.driver_id = d.driver_id
                WHERE s.driver_id = ? AND s.status != 'cancelled'
                AND arrival_time <= ? ORDER BY arrival_time DESC LIMIT 1`,
        [driver_id, departure_time], (err, rows) => {
          if (!err && rows && rows.length > 0) {
            const gapMs = departureMs - new Date(rows[0].arrival_time).getTime();
            if (gapMs / (1000 * 60 * 60) < 1) {
              resolve(`⛔ Driver "${rows[0].name}" needs 1hr rest! Gap: ${Math.round(gapMs/60000)} mins.`);
            } else resolve(null);
          } else resolve(null);
        });
    }));

    blockChecks.push(new Promise((resolve) => {
      const depDate = new Date(departure_time).toISOString().split('T')[0];
      db.query(`SELECT SUM(TIMESTAMPDIFF(MINUTE, departure_time, arrival_time)) as total_mins,
                d.full_name as name FROM schedules s
                LEFT JOIN drivers d ON s.driver_id = d.driver_id
                WHERE s.driver_id = ? AND s.status != 'cancelled' AND DATE(departure_time) = ?`,
        [driver_id, depDate], (err, rows) => {
          if (!err && rows && rows[0] && rows[0].total_mins) {
            const totalAfter = (rows[0].total_mins / 60) + tripDurationHrs;
            if (totalAfter > 8) {
              resolve(`⛔ Driver "${rows[0].name}" will exceed 8hr daily limit! Total: ${totalAfter.toFixed(1)}hrs.`);
            } else resolve(null);
          } else resolve(null);
        });
    }));
  }

  Promise.all(blockChecks).then((results) => {
    const errors = results.filter(r => r !== null);
    if (errors.length > 0) {
      db.query('SELECT * FROM routes WHERE status="active"', (err, routes) => {
        db.query('SELECT * FROM buses', (err, buses) => {
          db.query('SELECT * FROM drivers', (err, drivers) => {
            return res.render('schedules/add', {
              user: req.session.user, routes, buses, drivers,
              error: errors.join(' | ')
            });
          });
        });
      });
    } else {
      db.query('SELECT end_point FROM routes WHERE route_id = ?', [route_id], (err, routeResult) => {
        const endPoint = routeResult && routeResult[0] ? routeResult[0].end_point : 'Colombo';
        if (bus_id) db.query('UPDATE buses SET current_location = ? WHERE bus_id = ?', [endPoint, bus_id], () => {});
        if (driver_id) db.query('UPDATE drivers SET current_location = ? WHERE driver_id = ?', [endPoint, driver_id], () => {});
        db.query('INSERT INTO schedules (route_id, bus_id, driver_id, departure_time, arrival_time, schedule_type, status) VALUES (?,?,?,?,?,?,?)',
          [route_id, bus_id||null, driver_id||null, departure_time, arrival_time, schedule_type, status],
          (err) => { if (err) console.log(err); res.redirect('/schedules'); });
      });
    }
  });
});

router.get('/schedules/view/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query(`SELECT s.*, r.route_name, r.start_point, r.end_point, r.distance_km,
            b.registration_no, b.model, b.seating_capacity, b.fuel_type,
            d.full_name as driver_name, d.phone as driver_phone, d.license_no, d.license_expiry
            FROM schedules s
            LEFT JOIN routes r ON s.route_id = r.route_id
            LEFT JOIN buses b ON s.bus_id = b.bus_id
            LEFT JOIN drivers d ON s.driver_id = d.driver_id
            WHERE s.schedule_id = ?`, [req.params.id], (err, result) => {
    if (err || result.length === 0) return res.redirect('/schedules');
    db.query(`SELECT * FROM trips WHERE schedule_id = ? ORDER BY created_at DESC`,
      [req.params.id], (err, trips) => {
      res.render('schedules/view', {
        user: req.session.user,
        schedule: result[0],
        trips: trips || []
      });
    });
  });
});

router.get('/schedules/edit/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query('SELECT * FROM schedules WHERE schedule_id = ?', [req.params.id], (err, result) => {
    db.query('SELECT * FROM routes', (err, routes) => {
      db.query('SELECT * FROM buses', (err, buses) => {
        db.query('SELECT * FROM drivers', (err, drivers) => {
          res.render('schedules/edit', {
            user: req.session.user, schedule: result[0],
            routes, buses, drivers, error: null, success: null
          });
        });
      });
    });
  });
});



router.post('/schedules/edit/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { route_id, bus_id, driver_id, departure_time, arrival_time, schedule_type, status } = req.body;
  db.query('UPDATE schedules SET route_id=?, bus_id=?, driver_id=?, departure_time=?, arrival_time=?, schedule_type=?, status=? WHERE schedule_id=?',
    [route_id, bus_id||null, driver_id||null, departure_time, arrival_time, schedule_type, status, req.params.id],
    (err) => { res.redirect('/schedules'); });
});

router.get('/schedules/delete/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  // முதல்ல trips delete பண்ணு
  db.query('DELETE FROM trips WHERE schedule_id = ?', [req.params.id], (err) => {
    // அப்புறம் schedule delete பண்ணு
    db.query('DELETE FROM schedules WHERE schedule_id = ?', [req.params.id], (err) => {
      res.redirect('/schedules');
    });
  });
});

module.exports = router;