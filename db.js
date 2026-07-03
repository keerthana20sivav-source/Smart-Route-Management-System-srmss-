const mysql = require('mysql2');

const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'Root2003#K', // MySQL password 
  database: 'srmss_db'
});

connection.connect((err) => {
  if (err) {
    console.error('DB Connection Failed:', err);
    return;
  }
  console.log('MySQL Connected Successfully!');
});

module.exports = connection;