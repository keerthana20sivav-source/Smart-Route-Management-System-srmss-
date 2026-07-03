const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');

router.get('/', (req, res) => {
  res.render('auth/login', { error: null });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err || results.length === 0) {
      return res.render('auth/login', { error: 'Invalid email or password' });
    }
    const user = results[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.render('auth/login', { error: 'Invalid email or password' });
    }
    // ✅ Role save பண்ணு
    req.session.user = {
      user_id: user.user_id,
      full_name: user.full_name,
      email: user.email,
      role: user.role || 'admin'
    };
    res.redirect('/dashboard');
  });
});

router.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/');

  const stats = {};
  const notifications = [];

  db.query('SELECT COUNT(*) as count FROM routes', (err, r) => {
    stats.totalRoutes = r[0].count;

    db.query("SELECT COUNT(*) as count FROM buses WHERE status='available'", (err, r) => {
      stats.activeBuses = r[0].count;

      db.query('SELECT COUNT(*) as count FROM drivers', (err, r) => {
        stats.totalDrivers = r[0].count;

        db.query("SELECT COUNT(*) as count FROM schedules WHERE DATE(departure_time) = CURDATE()", (err, r) => {
          stats.todaySchedules = r[0].count;

          db.query(`SELECT full_name, license_no, license_expiry,
                    DATEDIFF(license_expiry, CURDATE()) as days_left
                    FROM drivers
                    WHERE license_expiry IS NOT NULL
                    AND DATEDIFF(license_expiry, CURDATE()) <= 30
                    AND DATEDIFF(license_expiry, CURDATE()) >= 0
                    ORDER BY license_expiry ASC`, (err, expiring) => {

            if (expiring) {
              expiring.forEach(d => {
                notifications.push({
                  type: 'license',
                  level: d.days_left <= 7 ? 'danger' : 'warning',
                  message: `🪪 Driver "${d.full_name}" license expires in ${d.days_left} days! (${new Date(d.license_expiry).toLocaleDateString()})`,
                  icon: 'fas fa-id-card'
                });
              });
            }

            db.query(`SELECT b.registration_no, m.next_service_date,
                      DATEDIFF(m.next_service_date, CURDATE()) as days_left
                      FROM maintenance_logs m
                      LEFT JOIN buses b ON m.bus_id = b.bus_id
                      WHERE m.next_service_date IS NOT NULL
                      AND DATEDIFF(m.next_service_date, CURDATE()) <= 14
                      AND DATEDIFF(m.next_service_date, CURDATE()) >= 0
                      ORDER BY m.next_service_date ASC`, (err, maintenance) => {

              if (maintenance) {
                maintenance.forEach(m => {
                  notifications.push({
                    type: 'maintenance',
                    level: m.days_left <= 3 ? 'danger' : 'warning',
                    message: `🔧 Bus "${m.registration_no}" maintenance due in ${m.days_left} days! (${new Date(m.next_service_date).toLocaleDateString()})`,
                    icon: 'fas fa-wrench'
                  });
                });
              }

              db.query(`SELECT SUM(liters) as total_liters, SUM(cost) as total_cost
                        FROM fuel_logs
                        WHERE MONTH(log_date) = MONTH(CURDATE())`, (err, fuelResult) => {

                stats.monthlyFuel = parseFloat(fuelResult && fuelResult[0] && fuelResult[0].total_liters || 0).toFixed(1);
                stats.monthlyFuelCost = parseFloat(fuelResult && fuelResult[0] && fuelResult[0].total_cost || 0).toFixed(0);

                db.query(`SELECT t.*, r.route_name
                          FROM trips t
                          LEFT JOIN schedules s ON t.schedule_id = s.schedule_id
                          LEFT JOIN routes r ON s.route_id = r.route_id
                          ORDER BY t.created_at DESC LIMIT 5`, (err, trips) => {

                  db.query(`SELECT b.bus_id, b.registration_no,
                            COALESCE(SUM(CASE WHEN TIMESTAMPDIFF(HOUR, s.departure_time, s.arrival_time) > 0
                            THEN TIMESTAMPDIFF(HOUR, s.departure_time, s.arrival_time)
                            ELSE 0 END), 0) as used_hours
                            FROM buses b
                            LEFT JOIN schedules s ON b.bus_id = s.bus_id
                            AND s.status != 'cancelled'
                            AND MONTH(s.departure_time) = MONTH(CURDATE())
                            GROUP BY b.bus_id`, (err, utilization) => {

                    const utilizationData = utilization ? utilization.map(b => ({
                      registration_no: b.registration_no,
                      used_hours: b.used_hours,
                      percentage: Math.min(Math.round((b.used_hours / 720) * 100), 100)
                    })) : [];

                    res.render('dashboard/index', {
                      user: req.session.user,
                      stats,
                      trips: trips || [],
                      notifications,
                      utilizationData
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;