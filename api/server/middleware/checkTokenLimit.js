/**
 * Middleware to block users who exceeded their token limit
 */
module.exports = function checkTokenLimit(req, res, next) {
  try {
    const user = req.user;
    if (user && user.tokens && user.tokens.blocked) {
      return res.status(403).json({ error: 'Limite de tokens atingido. Contate o administrador.' });
    }
    return next();
  } catch (e) {
    return next(e);
  }
};
