const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

test('migration additive : conservation exacte des données historiques', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/english_center_test');
  const sql = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20260912190000_add_course_structure/migration.sql'), 'utf8');
  assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    // A transactional schema models the old columns without changing public tables.
    await client.query('CREATE SCHEMA course_structure_migration_check');
    await client.query('SET LOCAL search_path TO course_structure_migration_check');
    await client.query(`
      CREATE TABLE courses (id integer PRIMARY KEY, price numeric(10,2), currency text, duration_value integer, duration_unit text);
      CREATE TABLE training_sessions (id integer PRIMARY KEY, course_id integer, name text);
      CREATE TABLE enrollments (id integer PRIMARY KEY, expected_total_amount numeric(10,2));
      CREATE TABLE payments (id integer PRIMARY KEY, amount numeric(10,2));
      CREATE TABLE student_invoices (id integer PRIMARY KEY, amount numeric(10,2));
      CREATE TABLE student_payments (id integer PRIMARY KEY, amount numeric(10,2));
      INSERT INTO courses VALUES (1, 60, 'USD', 24, 'HOURS'), (2, 40, 'USD', 12, 'HOURS');
      INSERT INTO training_sessions VALUES (1, 1, 'Niveau 3 - ancienne session'), (2, 2, 'Excel');
      INSERT INTO enrollments VALUES (1, 60);
      INSERT INTO payments VALUES (1, 30);
      INSERT INTO student_invoices VALUES (1, 60);
      INSERT INTO student_payments VALUES (1, 30);
    `);
    const tables = ['courses', 'training_sessions', 'enrollments', 'payments', 'student_invoices', 'student_payments'];
    const before = {};
    for (const table of tables) before[table] = (await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    await client.query(sql);
    for (const table of tables) {
      const after = (await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
      assert.equal(after.length, before[table].length);
      for (let i = 0; i < after.length; i++) {
        for (const [column, value] of Object.entries(before[table][i])) assert.deepEqual(after[i][column], value, `${table}.${column}`);
        if (table === 'courses') {
          assert.equal(after[i].structure_type, 'SIMPLE');
          assert.equal(after[i].access_policy, 'LEGACY_STAGED');
          assert.equal(after[i].number_of_levels, null);
          assert.equal(after[i].session_count, null);
        }
        if (table === 'training_sessions') assert.equal(after[i].level_number, null);
      }
    }
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
