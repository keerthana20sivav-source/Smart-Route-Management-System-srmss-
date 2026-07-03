const mysql = require('mysql2');

const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'Root2003#K',
  database: process.env.DB_NAME || 'srmss_db',
  port: process.env.DB_PORT || 3306
});

db.connect((err) => {
  if (err) {
    console.error('MySQL Connection Error:', err);
    return;
  }
  console.log('MySQL Connected Successfully!');
});

module.exports = db;