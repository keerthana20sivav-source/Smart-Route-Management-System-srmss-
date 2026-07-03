function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/');
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('403', { user: req.session.user });
    }
    next();
  };
}

module.exports = requireRole;