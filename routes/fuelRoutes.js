const express = require('express');
const router = express.Router();
const db = require('../db');

// ============================================================
// 📊 FUEL LOGS - LIST WITH SUMMARY & HIGH USAGE ROUTES
// ============================================================
router.get('/fuel', (req, res) => {
    if (!req.session.user) return res.redirect('/');

    // 1️⃣ Get all fuel logs with bus, route, user details
    db.query(`
        SELECT f.*, 
               b.registration_no, 
               r.route_name, 
               u.full_name as recorded_by_name
        FROM fuel_logs f
        LEFT JOIN buses b ON f.bus_id = b.bus_id
        LEFT JOIN routes r ON f.route_id = r.route_id
        LEFT JOIN users u ON f.recorded_by = u.user_id
        ORDER BY f.log_date DESC
    `, (err, fuels) => {
        if (err) {
            console.error(err);
            return res.render('fuel/list', { 
                user: req.session.user, 
                fuels: [],
                summary: {},
                highUsageRoutes: []
            });
        }

        // 2️⃣ Get FUEL SUMMARY
        db.query(`
            SELECT 
                COUNT(*) as total_entries,
                SUM(liters) as total_liters,
                SUM(cost) as total_cost,
                AVG(cost) as avg_cost
            FROM fuel_logs
        `, (err, summaryResult) => {
            const summary = summaryResult && summaryResult[0] ? summaryResult[0] : {};

            // 3️⃣ Get HIGH-USAGE ROUTES (Top 5 routes by fuel consumption)
            db.query(`
                SELECT 
                    r.route_id,
                    r.route_name,
                    r.start_point,
                    r.end_point,
                    r.distance_km,
                    COUNT(f.fuel_id) as trip_count,
                    SUM(f.liters) as total_liters,
                    SUM(f.cost) as total_cost,
                    AVG(f.liters) as avg_liters_per_trip
                FROM fuel_logs f
                JOIN routes r ON f.route_id = r.route_id
                GROUP BY f.route_id
                ORDER BY total_liters DESC
                LIMIT 5
            `, (err, highUsageRoutes) => {
                if (err) {
                    console.error(err);
                    highUsageRoutes = [];
                }

                res.render('fuel/list', {
                    user: req.session.user,
                    fuels: fuels || [],
                    summary: summary,
                    highUsageRoutes: highUsageRoutes || []
                });
            });
        });
    });
});

// ============================================================
// ➕ FUEL LOG - ADD PAGE
// ============================================================
router.get('/fuel/add', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    
    db.query('SELECT * FROM buses WHERE status != "inactive"', (err, buses) => {
        db.query('SELECT * FROM routes WHERE status = "active"', (err, routes) => {
            res.render('fuel/add', { 
                user: req.session.user, 
                buses: buses || [],
                routes: routes || [],
                error: null 
            });
        });
    });
});

// ============================================================
// ➕ FUEL LOG - ADD POST
// ============================================================
router.post('/fuel/add', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    
    const { bus_id, route_id, liters, cost, log_date } = req.body;

    if (!bus_id || !liters || !cost || !log_date) {
        return res.render('fuel/add', {
            user: req.session.user,
            buses: [],
            routes: [],
            error: '❌ Please fill all required fields'
        });
    }

    db.query(`
        INSERT INTO fuel_logs 
        (bus_id, route_id, liters, cost, log_date, recorded_by) 
        VALUES (?, ?, ?, ?, ?, ?)
    `, [bus_id || null, route_id || null, liters, cost, log_date, req.session.user.user_id],
    (err) => {
        if (err) {
            console.error(err);
            return res.render('fuel/add', {
                user: req.session.user,
                buses: [],
                routes: [],
                error: '❌ Failed to add fuel log. Please try again.'
            });
        }
        res.redirect('/fuel');
    });
});

// ============================================================
// 🗑️ FUEL LOG - DELETE
// ============================================================
router.get('/fuel/delete/:id', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    
    db.query('DELETE FROM fuel_logs WHERE fuel_id = ?', [req.params.id], (err) => {
        if (err) console.error(err);
        res.redirect('/fuel');
    });
});

module.exports = router;