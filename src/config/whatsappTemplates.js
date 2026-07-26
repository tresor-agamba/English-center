const TYPE_TO_KEY = {
  LIVE_CLASS_REMINDER: 'class_reminder_24h',
  LIVE_CLASS_CANCELLED: 'class_cancelled',
  LIVE_CLASS_RESCHEDULED: 'class_rescheduled',
  ASSIGNMENT_PUBLISHED: 'assignment_published',
  ASSIGNMENT_DEADLINE_REMINDER: 'assignment_deadline_24h',
  FEEDBACK_PUBLISHED: 'assignment_feedback',
  PAYMENT_REQUIRED: 'payment_required',
  PAYMENT_CONFIRMED: 'payment_confirmed',
  TEACHER_ASSIGNED: 'teacher_assigned',
};
const TEMPLATES = {
  class_reminder_24h: 'english_center_class_reminder_24h',
  class_reminder_30m: 'english_center_class_reminder_30m',
  class_rescheduled: 'english_center_class_rescheduled',
  class_cancelled: 'english_center_class_cancelled',
  assignment_published: 'english_center_assignment_published',
  assignment_deadline_24h: 'english_center_assignment_deadline_24h',
  assignment_feedback: 'english_center_assignment_feedback',
  payment_required: 'english_center_payment_required',
  payment_confirmed: 'english_center_payment_confirmed',
  teacher_assigned: 'english_center_teacher_assigned',
};
function templateForNotification(notification) {
  let key = TYPE_TO_KEY[notification.type];
  if (notification.type === 'LIVE_CLASS_REMINDER' && notification.deduplicationKey?.endsWith(':30M')) key = 'class_reminder_30m';
  if (!key || !TEMPLATES[key]) return null;
  const values = [notification.user.firstName, notification.title, notification.message].map(value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500));
  return { key, templateName: TEMPLATES[key], languageCode: 'fr', parameters: values };
}
module.exports = { TYPE_TO_KEY, TEMPLATES, templateForNotification, WHATSAPP_ALLOWED_NOTIFICATION_TYPES: Object.keys(TYPE_TO_KEY) };
