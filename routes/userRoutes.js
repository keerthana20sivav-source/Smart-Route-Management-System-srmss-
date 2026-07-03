const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');

router.get('/users', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  if (req.session.user.role !== 'admin') return res.redirect('/dashboard');
  db.query('SELECT * FROM users ORDER BY created_at DESC', (err, users) => {
    res.render('users/list', { user: req.session.user, users });
  });
});

router.get('/users/add', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.render('users/add', { user: req.session.user, error: null });
});

router.post('/users/add', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { full_name, email, password, role } = req.body;
  bcrypt.hash(password, 10, (err, hash) => {
    db.query('INSERT INTO users (full_name, email, password, role) VALUES (?,?,?,?)',
      [full_name, email, hash, role],
      (err) => {
        if (err) {
          return res.render('users/add', { user: req.session.user, error: 'Email already exists!' });
        }
        res.redirect('/users');
      });
  });
});

router.get('/users/delete/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  if (req.params.id == req.session.user.user_id) return res.redirect('/users');
  db.query('DELETE FROM users WHERE user_id = ?', [req.params.id], (err) => {
    res.redirect('/users');
  });
});

module.exports = router;