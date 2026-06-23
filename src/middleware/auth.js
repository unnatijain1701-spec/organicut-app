  const jwt = require('jsonwebtoken');

  function authenticateToken(req, res, next) {
    const token = req.cookies?.token
      || req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired session — please log in again' });
    }
  }

  module.exports = { authenticateToken };
