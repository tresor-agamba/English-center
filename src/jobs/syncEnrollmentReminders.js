require('dotenv').config();
const prisma = require('../utils/prisma');
const service = require('../services/enrollmentReminderService');

(async () => {
  let analyzed = 0, scheduled = 0, cancelled = 0, errors = 0, cursor;
  try {
    while (true) {
      const rows = await prisma.enrollment.findMany({
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true }, orderBy: { id: 'asc' }, take: 100,
      });
      if (!rows.length) break;
      for (const row of rows) {
        analyzed += 1;
        try {
          const result = await service.synchronizeEnrollmentReminders(row.id);
          scheduled += result.scheduled || 0; cancelled += result.cancelled || 0;
        } catch (error) { errors += 1; console.error(`Inscription ${row.id}:`, error.message); }
      }
      cursor = rows.at(-1).id;
    }
    console.log(`Inscriptions analysées: ${analyzed}; rappels planifiés: ${scheduled}; rappels annulés: ${cancelled}; erreurs: ${errors}.`);
    process.exitCode = errors ? 1 : 0;
  } catch (error) {
    console.error('Échec de la synchronisation:', error.message); process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
})();
