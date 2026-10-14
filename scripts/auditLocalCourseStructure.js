// Read-only local audit. Never prints credentials or connects to a remote host.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { Prisma } = require('@prisma/client');
const root = path.resolve(__dirname, '..');
const normalize = text => text.replace(/\r\n/g, '\n').trim();
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

async function inspect(variable) {
  const value = process.env[variable];
  if (!value) return { variable, available: false };
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error(`${variable}: audit refused for a non-local host`);
  const client = new Client({ connectionString: value });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const identity = (await client.query('SELECT current_database() AS database, current_schema() AS schema, inet_server_addr()::text AS address, inet_server_port() AS port, version() AS version')).rows[0];
    const columns = (await client.query(`SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, numeric_precision, numeric_scale
      FROM information_schema.columns WHERE table_schema = current_schema() AND
      ((table_name = 'courses' AND column_name IN ('structure_type','number_of_levels','session_count','access_policy','duration_value','duration_unit','price'))
      OR (table_name = 'training_sessions' AND column_name IN ('course_id','level_number','status')))
      ORDER BY table_name, ordinal_position`)).rows;
    const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('_prisma_migrations','courses','training_sessions','enrollments','academic_cohorts')")).rows.map(r => r.table_name);
    const migrations = tables.includes('_prisma_migrations') ? (await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at')).rows : [];
    const applied = new Map(migrations.filter(m => m.finished_at && !m.rolled_back_at).map(m => [m.migration_name, m.checksum]));
    const repositoryMigrations = fs.readdirSync(path.join(root, 'prisma/migrations'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => {
      const sql = fs.readFileSync(path.join(root, 'prisma/migrations', e.name, 'migration.sql'));
      return { name: e.name, applied: applied.has(e.name), checksumMatches: applied.has(e.name) ? hash(sql) === applied.get(e.name) : null };
    });
    const courseColumns = columns.filter(c => c.table_name === 'courses').map(c => c.column_name);
    const sessionColumns = columns.filter(c => c.table_name === 'training_sessions').map(c => c.column_name);
    const courses = tables.includes('courses') ? (await client.query(`SELECT id,title,slug,${courseColumns.join(',')} FROM courses WHERE title ILIKE '%anglais%' OR title ILIKE '%english%' ORDER BY id`)).rows : [];
    for (const course of courses) {
      course.trainingSessions = tables.includes('training_sessions') ? (await client.query(`SELECT id,name,course_id,status${sessionColumns.includes('level_number') ? ',level_number' : ''} FROM training_sessions WHERE course_id=$1 ORDER BY id`, [course.id])).rows : [];
      for (const session of course.trainingSessions) session.enrollmentCount = tables.includes('enrollments') ? Number((await client.query('SELECT count(*) FROM enrollments WHERE training_session_id=$1', [session.id])).rows[0].count) : 0;
      course.academicCohorts = tables.includes('academic_cohorts') ? (await client.query('SELECT id,name,course_id,status FROM academic_cohorts WHERE course_id=$1 ORDER BY id', [course.id])).rows : [];
    }
    const enums = (await client.query(`SELECT t.typname AS type, e.enumlabel AS value FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid WHERE t.typname IN ('TrainingStructure','CourseAccessPolicy','DurationUnit','TrainingSessionStatus') ORDER BY t.typname,e.enumsortorder`)).rows;
    await client.query('ROLLBACK');
    return { variable, host: url.hostname, ...identity, columns, enums, migrations, repositoryMigrations, courses };
  } finally { await client.end(); }
}

async function main() {
  const sourceSchema = normalize(fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8'));
  const generatedSchema = normalize(fs.readFileSync(path.join(root, 'node_modules/.prisma/client/schema.prisma'), 'utf8'));
  const client = { version: Prisma.prismaVersion, packageVersion: require('@prisma/client/package.json').version,
    schemaMatches: sourceSchema === generatedSchema, schemaHash: hash(sourceSchema), generatedSchemaHash: hash(generatedSchema),
    models: Prisma.dmmf.datamodel.models.filter(m => ['Course','TrainingSession'].includes(m.name)).map(m => ({ name: m.name, fields: m.fields.filter(f => ['structureType','numberOfLevels','sessionCount','accessPolicy','durationValue','durationUnit','price','courseId','levelNumber','status'].includes(f.name)).map(f => ({ name: f.name, column: f.dbName || f.name, type: f.type, required: f.isRequired })) })) };
  const report = { auditedAt: new Date().toISOString(), client, databases: [await inspect('DATABASE_URL'), await inspect('TEST_DATABASE_URL')] };
  const output = path.join(root, 'output/local-course-structure-database-audit.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, clientMatches: client.schemaMatches, clientVersion: client.packageVersion,
    databases: report.databases.map(d => ({ variable: d.variable, database: d.database, host: d.host, port: d.port, columns: d.columns,
      appliedMigrations: d.migrations?.filter(m => m.finished_at && !m.rolled_back_at).length, pending: d.repositoryMigrations?.filter(m => !m.applied).map(m => m.name),
      checksumMismatches: d.repositoryMigrations?.filter(m => m.checksumMatches === false), courses: d.courses })) }, null, 2));
}
main().catch(error => { console.error(error.code || error.name, error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')); process.exitCode = 1; });
