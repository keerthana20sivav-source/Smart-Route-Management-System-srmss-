const express = require('express');
const router = express.Router();
const db = require('../db');
const PDFDocument = require('pdfkit');

router.get('/reports', (req, res) => {
  if (!req.session.user) return res.redirect('/');

  const period = req.query.period || 'month';
  const stats = {};

  // Period date filter
  let periodFilter = '';
  let periodLabel = '';
  if (period === 'week') {
    periodFilter = `AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`;
    periodLabel = 'This Week';
  } else if (period === 'month') {
    periodFilter = `AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())`;
    periodLabel = 'This Month';
  } else {
    periodFilter = '';
    periodLabel = 'All Time';
  }

  let fuelPeriodFilter = '';
  if (period === 'week') {
    fuelPeriodFilter = `AND log_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`;
  } else if (period === 'month') {
    fuelPeriodFilter = `AND MONTH(log_date) = MONTH(CURDATE()) AND YEAR(log_date) = YEAR(CURDATE())`;
  }

  db.query('SELECT COUNT(*) as count FROM routes', (err, r) => {
    stats.totalRoutes = r[0].count || 0;
    db.query('SELECT COUNT(*) as count FROM buses', (err, r) => {
      stats.totalBuses = r[0].count || 0;
      db.query('SELECT COUNT(*) as count FROM drivers', (err, r) => {
        stats.totalDrivers = r[0].count || 0;
        db.query('SELECT COUNT(*) as count FROM schedules', (err, r) => {
          stats.totalSchedules = r[0].count || 0;
          db.query(`SELECT SUM(liters) as total, SUM(cost) as totalCost FROM fuel_logs WHERE 1=1 ${fuelPeriodFilter}`, (err, r) => {
            stats.totalFuel = r[0].total || 0;
            stats.totalFuelCost = r[0].totalCost || 0;
            db.query('SELECT SUM(cost) as total FROM maintenance_logs', (err, r) => {
              stats.totalMaintenanceCost = r[0].total || 0;

              // Fuel by route
              db.query(`SELECT r.route_name, SUM(f.liters) as total_liters, SUM(f.cost) as total_cost,
                        COUNT(f.fuel_id) as trip_count
                        FROM fuel_logs f LEFT JOIN routes r ON f.route_id = r.route_id
                        WHERE f.route_id IS NOT NULL ${fuelPeriodFilter}
                        GROUP BY f.route_id ORDER BY total_liters DESC LIMIT 5`,
                (err, fuelByRoute) => {

                // Trip stats with period filter
                db.query(`SELECT COUNT(*) as total_trips,
                          SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed_trips,
                          SUM(CASE WHEN status='on_time' THEN 1 ELSE 0 END) as on_time_trips,
                          SUM(CASE WHEN status='delayed' THEN 1 ELSE 0 END) as delayed_trips,
                          SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) as cancelled_trips
                          FROM trips WHERE 1=1 ${periodFilter}`, (err, tripStats) => {
                  if (err) console.error('tripStats err:', err);
                  const tripData = (tripStats && tripStats[0]) ? tripStats[0] : {};

                  // Route performance
                  db.query(`SELECT r.route_id, r.route_name, r.start_point, r.end_point,
                            COUNT(DISTINCT s.schedule_id) as total_schedules,
                            COUNT(DISTINCT t.trip_id) as total_trips,
                            SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) as completed_trips,
                            SUM(CASE WHEN t.status='on_time' THEN 1 ELSE 0 END) as on_time_trips,
                            SUM(CASE WHEN t.status='delayed' THEN 1 ELSE 0 END) as delayed_trips,
                            SUM(CASE WHEN t.status='cancelled' THEN 1 ELSE 0 END) as cancelled_trips
                            FROM routes r
                            LEFT JOIN schedules s ON r.route_id = s.route_id
                            LEFT JOIN trips t ON s.schedule_id = t.schedule_id
                            GROUP BY r.route_id ORDER BY total_trips DESC`,
                    (err, routePerformance) => {

                    // Fuel trends
                    db.query(`SELECT DATE_FORMAT(log_date, '%Y-%m') as month,
                              SUM(liters) as total_liters, SUM(cost) as total_cost, COUNT(*) as entry_count
                              FROM fuel_logs
                              WHERE log_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
                              GROUP BY DATE_FORMAT(log_date, '%Y-%m') ORDER BY month ASC`,
                      (err, fuelTrends) => {

                      // Driver performance with period filter
                      db.query(`SELECT d.full_name,
                                COUNT(t.trip_id) as total_trips,
                                SUM(CASE WHEN t.status='on_time' THEN 1 ELSE 0 END) as on_time,
                                SUM(CASE WHEN t.status='delayed' THEN 1 ELSE 0 END) as trip_delayed,
                                SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) as completed
                                FROM trips t
                                LEFT JOIN schedules s ON t.schedule_id = s.schedule_id
                                LEFT JOIN drivers d ON s.driver_id = d.driver_id
                                WHERE d.full_name IS NOT NULL ${periodFilter}
                                GROUP BY s.driver_id ORDER BY on_time DESC`,
                        (err, driverPerformance) => {

                        // Fuel by bus
                        db.query(`SELECT b.registration_no, b.fuel_type,
                                  SUM(f.liters) as total_liters, SUM(f.cost) as total_cost,
                                  COUNT(f.fuel_id) as refuel_count
                                  FROM fuel_logs f
                                  LEFT JOIN buses b ON f.bus_id = b.bus_id
                                  WHERE 1=1 ${fuelPeriodFilter}
                                  GROUP BY f.bus_id ORDER BY total_liters DESC`,
                          (err, fuelByBus) => {

                          // Maintenance summary
                          db.query(`SELECT b.registration_no,
                                    COUNT(m.maintenance_id) as total_services,
                                    SUM(m.cost) as total_cost,
                                    MAX(m.service_date) as last_service,
                                    MIN(m.next_service_date) as next_service
                                    FROM maintenance_logs m
                                    LEFT JOIN buses b ON m.bus_id = b.bus_id
                                    GROUP BY m.bus_id ORDER BY total_cost DESC`,
                            (err, maintSummary) => {

                            res.render('reports/index', {
                              user: req.session.user,
                              stats,
                              period,
                              periodLabel,
                              fuelByRoute: fuelByRoute || [],
                              tripStats: tripData,
                              routePerformance: routePerformance || [],
                              fuelTrends: fuelTrends || [],
                              driverPerformance: driverPerformance || [],
                              fuelByBus: fuelByBus || [],
                              maintSummary: maintSummary || [],
                              error: null
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
      });
    });
  });
});

router.get('/reports/pdf', (req, res) => {
  if (!req.session.user) return res.redirect('/');

  const period = req.query.period || 'month';
  let periodFilter = '';
  let periodLabel = 'This Month';
  if (period === 'week') { periodFilter = `AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`; periodLabel = 'This Week'; }
  else if (period === 'month') { periodFilter = `AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())`; periodLabel = 'This Month'; }
  else { periodFilter = ''; periodLabel = 'All Time'; }

  db.query('SELECT COUNT(*) as count FROM routes', (err, routes) => {
  db.query('SELECT COUNT(*) as count FROM buses', (err, buses) => {
  db.query('SELECT COUNT(*) as count FROM drivers', (err, drivers) => {
  db.query('SELECT COUNT(*) as count FROM schedules', (err, schedules) => {
  db.query('SELECT SUM(liters) as tl, SUM(cost) as tc FROM fuel_logs', (err, fuel) => {
  db.query('SELECT SUM(cost) as tc FROM maintenance_logs', (err, maint) => {
  db.query(`SELECT b.registration_no, SUM(f.liters) as liters, SUM(f.cost) as cost
            FROM fuel_logs f LEFT JOIN buses b ON f.bus_id = b.bus_id
            GROUP BY f.bus_id ORDER BY liters DESC`, (err, fuelData) => {
  db.query(`SELECT b.registration_no, m.type, m.description, m.cost, m.service_date
            FROM maintenance_logs m LEFT JOIN buses b ON m.bus_id = b.bus_id
            ORDER BY m.service_date DESC LIMIT 10`, (err, maintData) => {
  db.query(`SELECT COUNT(*) as total_trips,
            SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed_trips,
            SUM(CASE WHEN status='on_time' THEN 1 ELSE 0 END) as on_time_trips,
            SUM(CASE WHEN status='delayed' THEN 1 ELSE 0 END) as delayed_trips
            FROM trips WHERE 1=1 ${periodFilter}`, (err, tripStats) => {
  db.query(`SELECT d.full_name,
            COUNT(t.trip_id) as total_trips,
            SUM(CASE WHEN t.status='on_time' THEN 1 ELSE 0 END) as on_time,
            SUM(CASE WHEN t.status='delayed' THEN 1 ELSE 0 END) as trip_delayed
            FROM trips t
            LEFT JOIN schedules s ON t.schedule_id = s.schedule_id
            LEFT JOIN drivers d ON s.driver_id = d.driver_id
            WHERE d.full_name IS NOT NULL ${periodFilter}
            GROUP BY s.driver_id ORDER BY on_time DESC`, (err, driverData) => {

    const tStats = tripStats[0] || {};
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=SRMSS_Report_${period}.pdf`);
    doc.pipe(res);

    doc.fontSize(22).fillColor('#8B1A1A').text('SRMSS — Smart Route Management System', { align: 'center' });
    doc.fontSize(12).fillColor('#666').text(`Depot Management Report — ${periodLabel}`, { align: 'center' });
    doc.fontSize(10).fillColor('#999').text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);

    doc.fontSize(14).fillColor('#8B1A1A').text('1. Summary Statistics');
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#8B1A1A').stroke();
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#333');
    doc.text(`Total Routes: ${routes[0].count}`);
    doc.text(`Total Buses: ${buses[0].count}`);
    doc.text(`Total Drivers: ${drivers[0].count}`);
    doc.text(`Total Schedules: ${schedules[0].count}`);
    doc.text(`Total Fuel Used: ${parseFloat(fuel[0].tl || 0).toFixed(2)} L`);
    doc.text(`Total Fuel Cost: LKR ${parseFloat(fuel[0].tc || 0).toFixed(2)}`);
    doc.text(`Total Maintenance Cost: LKR ${parseFloat(maint[0].tc || 0).toFixed(2)}`);
    doc.moveDown(2);

    doc.fontSize(14).fillColor('#8B1A1A').text(`2. Trip Completion Rate (${periodLabel})`);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#8B1A1A').stroke();
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#333');
    const totalTrips = tStats.total_trips || 0;
    const completedTrips = tStats.completed_trips || 0;
    const onTimeTrips = tStats.on_time_trips || 0;
    const delayedTrips = tStats.delayed_trips || 0;
    const completionRate = totalTrips > 0 ? ((completedTrips / totalTrips) * 100).toFixed(1) : 0;
    const onTimeRate = totalTrips > 0 ? ((onTimeTrips / totalTrips) * 100).toFixed(1) : 0;
    doc.text(`Total Trips: ${totalTrips}`);
    doc.text(`Completed: ${completedTrips} (${completionRate}%)`);
    doc.text(`On Time: ${onTimeTrips} (${onTimeRate}%)`);
    doc.text(`Delayed: ${delayedTrips}`);
    doc.moveDown(2);

    doc.fontSize(14).fillColor('#8B1A1A').text(`3. Driver Performance (${periodLabel})`);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#8B1A1A').stroke();
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#333');
    if (!driverData || driverData.length === 0) {
      doc.text('No driver trip data available.');
    } else {
      driverData.forEach((d, i) => {
        const rate = d.total_trips > 0 ? ((d.on_time / d.total_trips) * 100).toFixed(1) : 0;
        doc.text(`${i+1}. ${d.full_name} — Trips: ${d.total_trips} | On Time: ${d.on_time} (${rate}%) | Delayed: ${d.trip_delayed||0}`);
      });
    }
    doc.moveDown(2);

    doc.fontSize(14).fillColor('#8B1A1A').text('4. Fuel Consumption by Bus');
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#8B1A1A').stroke();
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#333');
    if (!fuelData || fuelData.length === 0) {
      doc.text('No fuel records found.');
    } else {
      fuelData.forEach(f => {
        doc.text(`${f.registration_no || 'N/A'} — ${parseFloat(f.liters || 0).toFixed(2)} L — LKR ${parseFloat(f.cost || 0).toFixed(2)}`);
      });
    }
    doc.moveDown(2);

    doc.fontSize(14).fillColor('#8B1A1A').text('5. Recent Maintenance Records');
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#8B1A1A').stroke();
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#333');
    if (!maintData || maintData.length === 0) {
      doc.text('No maintenance records found.');
    } else {
      maintData.forEach(m => {
        doc.text(`${m.registration_no || 'N/A'} | ${m.type} | LKR ${m.cost} | ${m.service_date ? new Date(m.service_date).toLocaleDateString() : 'N/A'}`);
        if (m.description) doc.fontSize(10).fillColor('#666').text(`  → ${m.description}`).fillColor('#333').fontSize(11);
      });
    }

    doc.moveDown(2);
    doc.fontSize(10).fillColor('#999').text('SRMSS v1.0 — Made in Sri Lanka', { align: 'center' });
    doc.end();
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

module.exports = router;