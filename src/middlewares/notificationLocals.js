const service = require('../services/notificationService');
module.exports = async function notificationLocals(req, res, next) {
  res.locals.unreadNotificationCount = 0;
  if (!req.session?.user?.id) return next();
  try {
    res.locals.unreadNotificationCount = await service.getUnreadCount(req.session.user.id);
    return next();
  } catch (error) { return next(error); }
};
