const express = require('express');
const router = express.Router();
const db = require('../db');
const axios = require('axios');

async function geocode(place) {
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: place + ', Sri Lanka', format: 'json', limit: 1 },
      headers: { 'User-Agent': 'SRMSS-App' }
    });
    if (response.data && response.data.length > 0) {
      return { lat: parseFloat(response.data[0].lat), lng: parseFloat(response.data[0].lon) };
    }
    return null;
  } catch (err) {
    console.log('Geocode error:', err.message);
    return null;
  }
}

router.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query(`SELECT r.*,
            GROUP_CONCAT(s.stop_name ORDER BY rs.stop_order SEPARATOR ', ') as stop_names
            FROM routes r
            LEFT JOIN route_stops rs ON r.route_id = rs.route_id
            LEFT JOIN stops s ON rs.stop_id = s.stop_id
            GROUP BY r.route_id
            ORDER BY r.created_at DESC`, (err, routes) => {
    res.render('routes/list', { user: req.session.user, routes });
  });
});

router.get('/add', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.render('routes/add', { user: req.session.user, error: null });
});

router.post('/add', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { route_name, start_point, end_point, distance_km, status } = req.body;
  let stops = req.body.stops || [];
  if (!Array.isArray(stops)) stops = [stops];
  stops = stops.filter(s => s && s.trim() !== '');

  db.query('INSERT INTO routes (route_name, start_point, end_point, distance_km, status) VALUES (?,?,?,?,?)',
    [route_name, start_point, end_point, distance_km || null, status],
    async (err, result) => {
      if (err) { console.log(err); return res.redirect('/routes'); }

      const routeId = result.insertId;
      let stopOrder = 1;

      // Save start point
      const startCoords = await geocode(start_point);
      await new Promise((resolve) => {
        db.query('INSERT INTO stops (stop_name, latitude, longitude) VALUES (?,?,?)',
          [start_point, startCoords ? startCoords.lat : null, startCoords ? startCoords.lng : null],
          (err, stopResult) => {
            if (!err) {
              db.query('INSERT INTO route_stops (route_id, stop_id, stop_order) VALUES (?,?,?)',
                [routeId, stopResult.insertId, stopOrder++], () => resolve());
            } else resolve();
          });
      });

      // Save intermediary stops
      for (const stopName of stops) {
        const coords = await geocode(stopName.trim());
        await new Promise((resolve) => {
          db.query('INSERT INTO stops (stop_name, latitude, longitude) VALUES (?,?,?)',
            [stopName.trim(), coords ? coords.lat : null, coords ? coords.lng : null],
            (err, stopResult) => {
              if (!err) {
                db.query('INSERT INTO route_stops (route_id, stop_id, stop_order) VALUES (?,?,?)',
                  [routeId, stopResult.insertId, stopOrder++], () => resolve());
              } else resolve();
            });
        });
      }

      // Save end point
      const endCoords = await geocode(end_point);
      db.query('INSERT INTO stops (stop_name, latitude, longitude) VALUES (?,?,?)',
        [end_point, endCoords ? endCoords.lat : null, endCoords ? endCoords.lng : null],
        (err, stopResult) => {
          if (!err) {
            db.query('INSERT INTO route_stops (route_id, stop_id, stop_order) VALUES (?,?,?)',
              [routeId, stopResult.insertId, stopOrder], () => {});
          }
        });

      res.redirect('/routes');
    });
});

router.get('/edit/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query('SELECT * FROM routes WHERE route_id = ?', [req.params.id], (err, result) => {
    if (err || result.length === 0) return res.redirect('/routes');
    // Get existing stops (intermediary only — exclude first and last)
    db.query(`SELECT s.stop_name, rs.stop_order FROM route_stops rs
              LEFT JOIN stops s ON rs.stop_id = s.stop_id
              WHERE rs.route_id = ?
              ORDER BY rs.stop_order ASC`, [req.params.id], (err, stopRows) => {
      // Filter out first and last stop (start + end)
      const intermediaryStops = stopRows && stopRows.length > 2
        ? stopRows.slice(1, -1).map(s => s.stop_name)
        : [];
      res.render('routes/edit', {
        user: req.session.user,
        route: result[0],
        existingStops: intermediaryStops,
        error: null
      });
    });
  });
});

router.post('/edit/:id', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { route_name, start_point, end_point, distance_km, status } = req.body;
  let stops = req.body.stops || [];
  if (!Array.isArray(stops)) stops = [stops];
  stops = stops.filter(s => s && s.trim() !== '');

  db.query('UPDATE routes SET route_name=?, start_point=?, end_point=?, distance_km=?, status=? WHERE route_id=?',
    [route_name, start_point, end_point, distance_km || null, status, req.params.id],
    async (err) => {
      if (err) { console.log(err); return res.redirect('/routes'); }

      const routeId = req.params.id;

      // Delete old stops
      db.query('DELETE FROM route_stops WHERE route_id = ?', [routeId], async () => {

        let stopOrder = 1;

        // Save start point
        const startCoords = await geocode(start_point);
        await new Promise((resolve) => {
          db.query('INSERT INTO stops (stop_name, latitude, longitude) VALUES (?,?,?)',
            [start_point, startCoords ? startCoords.lat : null, startCoords ? startCoords.lng : null],
            (err, stopResult) => {
              if (!err) {
                db.query('INSERT INTO route_stops (route_id, stop_id, stop_order) VALUES (?,?,?)',
                  [routeId, stopResult.insertId, stopOrder++], () => resolve());
              } else resolve();
            });
        });

        // Save intermediary stops
        for (const stopName of stops) {
          const coords = await geocode(stopName.trim());
          await new Promise((resolve) => {
            db.query('INSERT INTO stops (stop_name, latitude, longitude) VALUES (?,?,?)',
              [stopName.trim(), coords ? coords.lat : null, coords ? coords.lng : null],
              (err, stopResult) => {
                if (!err) {
                  db.query('INSERT INTO route_stops (route_id, stop_id, stop_order) VALUES (?,?,?)',
                    [routeId, stopResult.insertId, stopOrder++], () => resolve());
                } else resolve();
              });
          });
        }

        // Save end point
        const endCoords = await geocode(end_point);
        db.query('INSERT INTO stops (stop_name, latitude, longitude) VALUES (?,?,?)',
          [end_point, endCoords ? endCoords.lat : null, endCoords ? endCoords.lng : null],
          (err, stopResult) => {
            if (!err) {
              db.query('INSERT INTO route_stops (route_id, stop_id, stop_order) VALUES (?,?,?)',
                [routeId, stopResult.insertId, stopOrder], () => {});
            }
          });

        res.redirect('/routes');
      });
    });
});

router.get('/delete/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const id = req.params.id;
  db.query('DELETE FROM route_stops WHERE route_id = ?', [id], () => {
    db.query('DELETE FROM fuel_logs WHERE route_id = ?', [id], () => {
      db.query('DELETE FROM schedules WHERE route_id = ?', [id], () => {
        db.query('DELETE FROM routes WHERE route_id = ?', [id], (err) => {
          if (err) console.log('Delete error:', err);
          res.redirect('/routes');
        });
      });
    });
  });
});

router.get('/view/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query('SELECT * FROM routes WHERE route_id = ?', [req.params.id], (err, routeResult) => {
    if (err || routeResult.length === 0) return res.redirect('/routes');
    
    db.query(`SELECT s.stop_name, s.latitude, s.longitude, rs.stop_order
              FROM route_stops rs
              LEFT JOIN stops s ON rs.stop_id = s.stop_id
              WHERE rs.route_id = ?
              ORDER BY rs.stop_order ASC`, [req.params.id], (err, stops) => {
      
      db.query(`SELECT COUNT(*) as total_schedules FROM schedules WHERE route_id = ?`,
        [req.params.id], (err, scheduleCount) => {
        
        db.query(`SELECT SUM(f.liters) as total_fuel, SUM(f.cost) as total_cost
                  FROM fuel_logs f WHERE f.route_id = ?`, [req.params.id], (err, fuelStats) => {
          
          res.render('routes/view', {
            user: req.session.user,
            route: routeResult[0],
            stops: stops || [],
            totalSchedules: scheduleCount[0].total_schedules || 0,
            fuelStats: fuelStats[0] || {}
          });
        });
      });
    });
  });
});

router.get('/map', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  db.query(`SELECT r.*,
            GROUP_CONCAT(s.stop_name ORDER BY rs.stop_order SEPARATOR '|') as stop_names,
            GROUP_CONCAT(s.latitude ORDER BY rs.stop_order SEPARATOR '|') as latitudes,
            GROUP_CONCAT(s.longitude ORDER BY rs.stop_order SEPARATOR '|') as longitudes
            FROM routes r
            LEFT JOIN route_stops rs ON r.route_id = rs.route_id
            LEFT JOIN stops s ON rs.stop_id = s.stop_id
            WHERE r.status = 'active'
            GROUP BY r.route_id`, (err, routes) => {
    res.render('routes/map', { user: req.session.user, routes: routes || [] });
  });
});

module.exports = router;