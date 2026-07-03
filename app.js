const express = require('express');
const session = require('express-session');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'srmss_secret_key',
  resave: false,
  saveUninitialized: false
}));

// Supervisor — POST/DELETE block
app.use((req, res, next) => {
  if (req.session.user && req.session.user.role === 'supervisor') {
    if (req.method === 'POST' || req.method === 'DELETE') {
      return res.status(403).render('403', { user: req.session.user });
    }
    // GET /add, /edit, /delete URLs block
    if (req.path.includes('/add') || req.path.includes('/edit') || req.path.includes('/delete')) {
      return res.status(403).render('403', { user: req.session.user });
    }
  }
  next();
});

app.set('io', io);

// ===== ROLE CHECK MIDDLEWARE =====
const requireRole = require('./middleware/roleCheck');

const routeRoutes = require('./routes/routeRoutes');
const authRoutes = require('./routes/auth');
const busRoutes = require('./routes/busRoutes');
const driverRoutes = require('./routes/driverRoutes');
const scheduleRoutes = require('./routes/scheduleRoutes');
const fuelRoutes = require('./routes/fuelRoutes');
const maintenanceRoutes = require('./routes/maintenanceRoutes');
const reportRoutes = require('./routes/reportRoutes');
const userRoutes = require('./routes/userRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

// ===== ROUTES WITH ROLE PROTECTION =====

// Routes — Admin + Depot Officer
app.use('/routes', requireRole('admin', 'depot_officer', 'supervisor'), routeRoutes);

// Auth (no role needed)
app.use('/', authRoutes);

// Buses — Admin + Depot Officer
app.use('/buses', requireRole('admin', 'depot_officer', 'supervisor'), busRoutes);

// Drivers — Admin + Depot Officer
app.use('/', requireRole('admin', 'depot_officer', 'supervisor'), driverRoutes);

// Schedules — Admin + Depot Officer
app.use('/', requireRole('admin', 'depot_officer', 'supervisor'), scheduleRoutes);

// Fuel — Admin + Depot Officer
app.use('/', requireRole('admin', 'depot_officer', 'supervisor'), fuelRoutes);

// Maintenance — Admin + Depot Officer
app.use('/', requireRole('admin', 'depot_officer', 'supervisor'), maintenanceRoutes);

// Reports — All roles
app.use('/', requireRole('admin', 'depot_officer', 'supervisor'), reportRoutes);

// Users — Admin only
app.use('/', requireRole('admin'), userRoutes);

// Notifications — All roles
app.use('/', requireRole('admin', 'depot_officer', 'supervisor'), notificationRoutes);

// ===== LIVE BUS SIMULATION =====
const db = require('./db');
const simulatedBuses = {};

function startBusSimulation() {
  db.query(`SELECT r.route_id, r.route_name, b.bus_id, b.registration_no,
            GROUP_CONCAT(s.latitude ORDER BY rs.stop_order SEPARATOR '|') as lats,
            GROUP_CONCAT(s.longitude ORDER BY rs.stop_order SEPARATOR '|') as lngs
            FROM routes r
            LEFT JOIN buses b ON r.bus_id = b.bus_id
            LEFT JOIN route_stops rs ON r.route_id = rs.route_id
            LEFT JOIN stops s ON rs.stop_id = s.stop_id
            WHERE r.status = 'active' AND b.bus_id IS NOT NULL
            GROUP BY r.route_id`, (err, routes) => {
    if (err || !routes) return;
    routes.forEach(route => {
      if (!route.lats || !route.lngs) return;
      const lats = route.lats.split('|').map(Number);
      const lngs = route.lngs.split('|').map(Number);
      if (lats.length < 2) return;
      simulatedBuses[route.bus_id] = {
        bus_id: route.bus_id,
        registration_no: route.registration_no,
        route_name: route.route_name,
        lats, lngs,
        progress: Math.random(),
        direction: 1
      };
    });
  });
}

startBusSimulation();
setInterval(startBusSimulation, 30000);

setInterval(() => {
  const positions = [];
  Object.values(simulatedBuses).forEach(bus => {
    bus.progress += 0.01 * bus.direction;
    if (bus.progress >= 1) { bus.progress = 1; bus.direction = -1; }
    if (bus.progress <= 0) { bus.progress = 0; bus.direction = 1; }
    const segments = bus.lats.length - 1;
    const segProgress = bus.progress * segments;
    const segIndex = Math.min(Math.floor(segProgress), segments - 1);
    const localT = segProgress - segIndex;
    const lat = bus.lats[segIndex] + (bus.lats[segIndex + 1] - bus.lats[segIndex]) * localT;
    const lng = bus.lngs[segIndex] + (bus.lngs[segIndex + 1] - bus.lngs[segIndex]) * localT;
    positions.push({ bus_id: bus.bus_id, registration_no: bus.registration_no, route_name: bus.route_name, lat, lng });
  });
  io.emit('busPositions', positions);
}, 2000);

io.on('connection', (socket) => {
  console.log('Client connected for live tracking');
});

server.listen(3000, () => {
  console.log('SRMSS Server running on http://localhost:3000');
});