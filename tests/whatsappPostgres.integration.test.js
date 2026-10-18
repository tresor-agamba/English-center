// This file intentionally does not load dotenv. Supply its connection and
// expected server identity through the process environment.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomInt, randomUUID } = require('node:crypto');
const { readExplicitTestUrl: validateTarget } = require('../src/utils/whatsappIntegrationTarget');

const explicitTestUrl = validateTarget();
// The application services create a default Prisma singleton at import time.
// Point that singleton at the explicitly supplied test URL before importing it.
process.env.DATABASE_URL = explicitTestUrl.toString();
process.env.NODE_ENV = 'test';
// Defense in depth: every transport must be injected. Accidental fetch is fatal.
global.fetch = async () => { throw new Error('Network transport is forbidden in WhatsApp PostgreSQL tests.'); };

const prisma = require('../src/utils/prisma');
const { createWhatsAppConversationService } = require('../src/services/whatsappConversationService');
const { createWhatsAppConversationDeliveryService: deliveryFactory } = require('../src/services/whatsappConversationDeliveryService');
const deliveryDiagnostics = require('./helpers/whatsappDeliveryDiagnostics');
const { createWhatsAppFixtureClock } = require('./helpers/whatsappFixtureClock');
const createWhatsAppConversationDeliveryService = deliveryDiagnostics.instrumentFactory(deliveryFactory);
const { createWhatsAppProspectFollowUpService } = require('../src/services/whatsappProspectFollowUpService');
const { createWhatsAppConversationAdminService } = require('../src/services/whatsappConversationAdminService');
const { createWhatsAppHumanHandoffService } = require('../src/services/whatsappHumanHandoffService');

const EXPECTED_DB = 'nva_whatsapp_test';
const EXPECTED_ROLE = 'nva_whatsapp_test_runner';
const config = {
  enabled: true,
  fakeMode: true,
  maxAttempts: 3,
  batchSize: 20,
  prospectFollowUp24hTemplate: 'nva_test_follow_up_24h',
  prospectFollowUp72hTemplate: 'nva_test_follow_up_72h',
};
const configProvider = () => config;
const runId = randomUUID();
const ownedConversations = new Map();
const ownedUsers = new Map();
let databaseVerified = false;

// Opt-in diagnostic labels only; assertions and business decisions are unchanged.
if (deliveryDiagnostics.enabled()) test.beforeEach((context) => deliveryDiagnostics.setScenario(context.name));

async function verifyDatabaseIdentity(client) {
  const identity = await client.$queryRaw`
    SELECT current_database() AS database_name,
           current_user AS user_name,
           inet_server_addr()::text AS server_address,
           inet_server_port() AS server_port
  `;
  assert.equal(identity.length, 1);
  assert.equal(identity[0].database_name, EXPECTED_DB, 'Connected database is not the dedicated WhatsApp test database.');
  assert.equal(identity[0].user_name, EXPECTED_ROLE, 'Connected role is not the limited WhatsApp test role.');
  assert.equal(identity[0].server_address, process.env.NVA_WHATSAPP_TEST_EXPECTED_SERVER_ADDRESS, 'PostgreSQL server address did not match the expected test endpoint.');
  assert.equal(identity[0].server_port, Number(process.env.NVA_WHATSAPP_TEST_EXPECTED_SERVER_PORT), 'PostgreSQL server port did not match the expected test endpoint.');
}

async function verifyPostgresVersion(client) {
  const version = await client.$queryRaw`SELECT current_setting('server_version_num')::integer AS version_num`;
  assert.equal(version.length, 1, 'Could not inspect the PostgreSQL server version.');
  assert.equal(Math.floor(version[0].version_num / 10000), 16, 'This integration suite is prepared for PostgreSQL 16.x.');
}

async function verifyLeastPrivilegeRole(client) {
  const roles = await client.$queryRaw`
    SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication,
           r.rolbypassrls, pg_has_role(r.oid, r.oid, 'MEMBER') AS self_member,
           EXISTS (
             SELECT 1 FROM pg_roles inherited
             WHERE inherited.oid <> r.oid AND pg_has_role(r.oid, inherited.oid, 'MEMBER')
           ) AS has_role_memberships
    FROM pg_roles r WHERE r.rolname = current_user
  `;
  assert.equal(roles.length, 1, 'Could not inspect the connected PostgreSQL role.');
  const role = roles[0];
  assert.equal(role.rolsuper, false, 'Test role must not be a superuser.');
  assert.equal(role.rolcreatedb, false, 'Test role must not be able to create databases.');
  assert.equal(role.rolcreaterole, false, 'Test role must not be able to create or alter roles.');
  assert.equal(role.rolreplication, false, 'Test role must not have replication privileges.');
  assert.equal(role.rolbypassrls, false, 'Test role must not bypass row-level security.');
  assert.equal(role.has_role_memberships, false, 'Test role must not inherit or belong to another role.');

  const database = await client.$queryRaw`
    SELECT d.datdba = r.oid AS is_database_owner,
           has_database_privilege(current_user, d.oid, 'CONNECT') AS can_connect,
           has_database_privilege(current_user, d.oid, 'CREATE') AS can_create_schema,
           has_database_privilege(current_user, d.oid, 'TEMP') AS can_create_temp
    FROM pg_database d CROSS JOIN pg_roles r
    WHERE d.datname = current_database() AND r.rolname = current_user
  `;
  assert.equal(database.length, 1, 'Could not inspect test database privileges.');
  assert.equal(database[0].is_database_owner, false, 'Test role must not own the database.');
  assert.equal(database[0].can_connect, true, 'Test role must have CONNECT on the test database.');
  assert.equal(database[0].can_create_schema, false, 'Test role must not be able to create schemas.');
  assert.equal(database[0].can_create_temp, false, 'Test role must not be able to create temporary objects.');

  const ownedObjects = await client.$queryRaw`
    SELECT d.classid::regclass::text AS catalog_name, d.objid, d.objsubid, d.dbid
    FROM pg_shdepend d
    WHERE d.refclassid = 'pg_authid'::regclass
      AND d.refobjid = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND d.deptype = 'o'
      AND d.dbid IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))
  `;
  assert.equal(ownedObjects.length, 0, 'Test role owns a database object and may have implicit DDL rights.');

  const grantOptions = await client.$queryRaw`
    -- NULL ACLs use catalog owners and object-specific PostgreSQL defaults.
    -- Explicit empty ACLs mean no grants; NULLIF avoids passing zero-dimensional arrays to aclexplode.
    WITH runner AS (
      SELECT oid FROM pg_roles WHERE rolname = current_user
    ), grants AS (
      SELECT 'database'::text AS object_type, d.datname::text AS object_name, acl.grantee, acl.is_grantable
      FROM pg_database d CROSS JOIN LATERAL aclexplode(NULLIF(COALESCE(d.datacl, acldefault('d', d.datdba)), '{}'::aclitem[])) acl
      UNION ALL
      SELECT 'schema'::text, n.nspname::text, acl.grantee, acl.is_grantable
      FROM pg_namespace n CROSS JOIN LATERAL aclexplode(NULLIF(COALESCE(n.nspacl, acldefault('n', n.nspowner)), '{}'::aclitem[])) acl
      UNION ALL
      SELECT 'relation', n.nspname || '.' || c.relname, acl.grantee, acl.is_grantable
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(NULLIF(COALESCE(c.relacl,
        CASE WHEN c.relkind = 'S' THEN acldefault('S', c.relowner) ELSE acldefault('r', c.relowner) END), '{}'::aclitem[])) acl
      UNION ALL
      SELECT 'column', n.nspname || '.' || c.relname || '.' || a.attname, acl.grantee, acl.is_grantable
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(NULLIF(COALESCE(a.attacl, acldefault('c', c.relowner)), '{}'::aclitem[])) acl
      WHERE a.attnum > 0 AND NOT a.attisdropped
    )
    SELECT grants.object_type, grants.object_name
    FROM grants CROSS JOIN runner
    WHERE grants.is_grantable AND grants.grantee IN (runner.oid, 0)
  `;
  assert.equal(grantOptions.length, 0, 'Test role or PUBLIC has an object privilege with GRANT OPTION.');

  const schemas = await client.$queryRaw`
    SELECT n.nspname AS schema_name, n.nspowner = r.oid AS is_owner,
           has_schema_privilege(current_user, n.oid, 'USAGE') AS can_use,
           has_schema_privilege(current_user, n.oid, 'CREATE') AS can_create
    FROM pg_namespace n CROSS JOIN pg_roles r
    WHERE r.rolname = current_user
      AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
  `;
  const publicSchema = schemas.find((schema) => schema.schema_name === 'public');
  assert.ok(publicSchema, 'The required public schema is missing.');
  assert.equal(publicSchema.can_use, true, 'Test role must have USAGE on public.');
  assert.equal(publicSchema.can_create, false, 'Test role must not be able to modify the schema.');
  assert.ok(schemas.every((schema) => !schema.is_owner && !schema.can_create), 'Test role owns or can modify a non-system schema.');
  assert.ok(schemas.every((schema) => schema.can_use === (schema.schema_name === 'public')), 'Test role has unexpected schema USAGE privileges.');

  const allowed = {
    users: ['SELECT', 'INSERT', 'DELETE'],
    enrollments: ['SELECT'],
    whatsapp_preferences: ['SELECT'],
    whatsapp_conversations: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    whatsapp_conversation_messages: ['SELECT', 'INSERT', 'UPDATE'],
    whatsapp_commercial_consent_events: ['SELECT', 'INSERT'],
    whatsapp_prospect_follow_ups: ['SELECT', 'INSERT', 'UPDATE'],
  };
  const tables = await client.$queryRaw`
    SELECT n.nspname AS schema_name, c.relname AS table_name,
           has_table_privilege(current_user, c.oid, 'SELECT') AS can_select,
           has_table_privilege(current_user, c.oid, 'INSERT') AS can_insert,
           has_table_privilege(current_user, c.oid, 'UPDATE') AS can_update,
           has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete,
           has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate,
           has_table_privilege(current_user, c.oid, 'REFERENCES') AS can_reference,
           has_table_privilege(current_user, c.oid, 'TRIGGER') AS can_trigger
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  `;
  const privilegeColumn = { SELECT: 'can_select', INSERT: 'can_insert', UPDATE: 'can_update', DELETE: 'can_delete', REFERENCES: 'can_reference' };
  for (const [name, required] of Object.entries(allowed)) {
    assert.ok(tables.some((table) => table.schema_name === 'public' && table.table_name === name), `Required table ${name} is missing.`);
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      const hasPrivilege = tables.find((table) => table.schema_name === 'public' && table.table_name === name)[privilegeColumn[privilege] || `can_${privilege.toLowerCase()}`];
      assert.equal(hasPrivilege, required.includes(privilege), `Unexpected ${privilege} privilege on ${name}.`);
    }
  }
  for (const table of tables.filter((candidate) => candidate.schema_name !== 'public' || !Object.hasOwn(allowed, candidate.table_name))) {
    assert.ok(!Object.values(table).some((value, index) => index > 0 && value === true), `Test role has unexpected privileges on ${table.table_name}.`);
  }
  const columnGrants = await client.$queryRaw`
    SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
  `;
  assert.equal(columnGrants.length, 0, 'Column-level grants exist and make effective table permissions ambiguous.');

  const sequences = await client.$queryRaw`
    SELECT n.nspname AS schema_name, c.relname AS sequence_name,
           has_sequence_privilege(current_user, c.oid, 'USAGE') AS can_use,
           has_sequence_privilege(current_user, c.oid, 'SELECT') AS can_select,
           has_sequence_privilege(current_user, c.oid, 'UPDATE') AS can_update
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_' AND c.relkind = 'S'
  `;
  const requiredSequences = [];
  for (const table of ['users', 'whatsapp_conversations', 'whatsapp_conversation_messages', 'whatsapp_commercial_consent_events', 'whatsapp_prospect_follow_ups']) {
    const found = await client.$queryRaw`SELECT pg_get_serial_sequence(${`public.${table}`}, 'id') AS sequence_name`;
    assert.equal(found.length, 1);
    assert.ok(found[0].sequence_name, `Could not identify the id sequence for ${table}.`);
    requiredSequences.push(found[0].sequence_name.split('.').pop().replaceAll('"', ''));
  }
  for (const sequence of sequences) {
    const required = sequence.schema_name === 'public' && requiredSequences.includes(sequence.sequence_name);
    assert.equal(sequence.can_use, required, `Unexpected sequence USAGE privilege on ${sequence.sequence_name}.`);
    assert.equal(sequence.can_select, false, `Test role must not have SELECT on sequence ${sequence.sequence_name}.`);
    assert.equal(sequence.can_update, false, `Test role must not have UPDATE on sequence ${sequence.sequence_name}.`);
  }
  for (const required of requiredSequences) {
    assert.ok(sequences.some((sequence) => sequence.sequence_name === required && sequence.can_use), `Required sequence ${required} is not usable.`);
  }
}

async function verifyWhatsAppTablesEmpty(client) {
  const counts = await client.$queryRaw`
    SELECT (SELECT count(*) FROM public.whatsapp_conversations) AS conversations,
           (SELECT count(*) FROM public.whatsapp_conversation_messages) AS messages,
           (SELECT count(*) FROM public.whatsapp_commercial_consent_events) AS consents,
           (SELECT count(*) FROM public.whatsapp_prospect_follow_ups) AS follow_ups,
           (SELECT count(*) FROM public.users) AS users,
           (SELECT count(*) FROM public.enrollments) AS enrollments,
           (SELECT count(*) FROM public.whatsapp_preferences) AS preferences
  `;
  assert.equal(counts.length, 1);
  assert.ok(Object.values(counts[0]).every((count) => count === 0n), 'Dedicated test database contains fixtures or business rows; no writes allowed.');
}

async function newScope({ catalogCourses = [], registrationCourses = [] } = {}) {
  assert.equal(databaseVerified, true, 'No scenario may run before database verification.');
  const clock = createWhatsAppFixtureClock();
  const phoneNumber = `+2438${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  const [existingConversation, existingUsers, existingPreferenceCount] = await Promise.all([
    prisma.whatsAppConversation.findUnique({ where: { phoneNumber }, select: { id: true } }),
    prisma.user.findMany({ where: { OR: [{ phoneNumber }, { whatsappNumber: phoneNumber }] }, select: { id: true }, take: 2 }),
    prisma.whatsAppPreference.count({ where: { phoneNumber } }),
  ]);
  if (existingConversation || existingUsers.length || existingPreferenceCount > 0) throw new Error('Synthetic phone number collision detected; scenario stopped without modifying existing rows.');

  const followUps = createWhatsAppProspectFollowUpService({
    client: prisma,
    configProvider,
    now: clock.now,
    sender: async () => { throw new Error('The simulated follow-up sender must never be called by these tests.'); },
  });
  const conversationService = createWhatsAppConversationService({
    client: prisma,
    catalog: { listPublished: async () => catalogCourses },
    registration: { listCoursesForPublicRegistration: async () => registrationCourses },
    followUps,
    followUpConfig: configProvider,
    now: clock.now,
    publicAppUrl: 'https://nva.example.test',
  });
  const scope = {
    clock,
    phoneNumber,
    followUps,
    conversationService,
    async inbound(body, providerMessageId = `wamid.nva-it.${runId}.${randomUUID()}`) {
      const result = await conversationService.processInboundMessage({
        id: providerMessageId,
        from: phoneNumber.slice(1),
        timestamp: String(Math.floor(clock.now().getTime() / 1000)),
        type: 'text',
        text: { body },
      });
      if (result.conversationId) {
        scope.conversationId = result.conversationId;
        ownedConversations.set(result.conversationId, phoneNumber);
      }
      return result;
    },
  };
  return scope;
}

async function createSyntheticAdvisor({ role = 'ADMIN' } = {}) {
  assert.equal(databaseVerified, true, 'No fixture may be created before database verification.');
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
  const phoneNumber = `+2437${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  const [existingConversation, existingUsers, existingPreferenceCount] = await Promise.all([
    prisma.whatsAppConversation.findUnique({ where: { phoneNumber }, select: { id: true } }),
    prisma.user.findMany({ where: { OR: [{ phoneNumber }, { whatsappNumber: phoneNumber }] }, select: { id: true }, take: 2 }),
    prisma.whatsAppPreference.count({ where: { phoneNumber } }),
  ]);
  if (existingConversation || existingUsers.length || existingPreferenceCount > 0) throw new Error('Synthetic advisor phone collision detected; no existing row was reused or modified.');
  const user = await prisma.user.create({
    data: { firstName: 'WhatsApp', lastName: `Test ${suffix}`, phoneNumber, passwordHash: `test-only-${randomUUID()}`, role, isActive: true, mustChangePassword: false },
    select: { id: true, phoneNumber: true },
  });
  ownedUsers.set(user.id, { phoneNumber: user.phoneNumber, whatsappNumber: null });
  return user;
}

async function removeOwnedRows() {
  const errors = [];
  for (const [id, phoneNumber] of ownedConversations) {
    try {
      const row = await prisma.whatsAppConversation.findUnique({ where: { id }, select: { id: true, phoneNumber: true } });
      if (row && (row.id !== id || row.phoneNumber !== phoneNumber)) throw new Error('fixture identity mismatch');
      if (row) await prisma.whatsAppConversation.delete({ where: { id, phoneNumber } });
    } catch (error) {
      errors.push(`conversation id=${id}: ${error?.code || error?.name || 'cleanup error'}`);
    }
  }
  for (const [id, expectedNumbers] of ownedUsers) {
    try {
      const row = await prisma.user.findUnique({ where: { id }, select: { id: true, phoneNumber: true, whatsappNumber: true } });
      if (row && (row.id !== id || row.phoneNumber !== expectedNumbers.phoneNumber || row.whatsappNumber !== expectedNumbers.whatsappNumber)) throw new Error('fixture identity mismatch');
      if (row) await prisma.user.delete({ where: { id, phoneNumber: expectedNumbers.phoneNumber, whatsappNumber: expectedNumbers.whatsappNumber } });
    } catch (error) {
      errors.push(`user id=${id}: ${error?.code || error?.name || 'cleanup error'}`);
    }
  }
  return errors;
}

test.before(async () => {
  try {
    await prisma.$connect();
    await verifyDatabaseIdentity(prisma);
    await verifyPostgresVersion(prisma);
    await verifyLeastPrivilegeRole(prisma);
    await verifyWhatsAppTablesEmpty(prisma);
    databaseVerified = true;
  } catch (error) {
    await prisma.$disconnect().catch(() => {});
    if (error?.name === 'AssertionError') throw error;
    throw new Error('Could not verify the explicit WhatsApp test database identity and least-privilege configuration; no integration writes were started.');
  }
});

test.after(async () => {
  let cleanupErrors = [];
  try {
    if (databaseVerified) {
      await verifyDatabaseIdentity(prisma);
      cleanupErrors = await removeOwnedRows();
    }
  } finally {
    await prisma.$disconnect();
  }
  if (cleanupErrors.length) throw new Error(`Synthetic fixture cleanup failed: ${cleanupErrors.join('; ')}`);
});

test('PostgreSQL persists a conversation, inbound and outbound messages, delivery statuses and a fresh connection', async () => {
  const scope = await newScope();
  const inbound = await scope.inbound('Bonjour');
  assert.equal(inbound.queuedResponses, 1);

  const conversation = await prisma.whatsAppConversation.findUnique({
    where: { id: inbound.conversationId },
    include: { messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  });
  assert.equal(conversation.phoneNumber, scope.phoneNumber);
  assert.equal(conversation.messages.length, 2);
  assert.equal(conversation.messages[0].direction, 'INBOUND');
  assert.equal(conversation.messages[0].processingStatus, 'PROCESSED');
  assert.equal(conversation.messages[1].direction, 'OUTBOUND');
  assert.equal(conversation.messages[1].deliveryStatus, 'QUEUED');

  let simulatedSends = 0;
  scope.clock.observeFixture(...conversation.messages);
  const delivery = createWhatsAppConversationDeliveryService({
    client: prisma,
    configProvider,
    now: scope.clock.now,
    sender: async ({ phoneNumber, text, idempotencyKey }) => {
      simulatedSends += 1;
      assert.equal(phoneNumber, scope.phoneNumber);
      assert.ok(text);
      assert.ok(idempotencyKey);
      return { providerMessageId: `wamid.nva-it.delivery.${randomUUID()}` };
    },
  });
  assert.deepEqual(await delivery.sendMessage(conversation.messages[1].id), { accepted: true });
  assert.equal(simulatedSends, 1);
  const accepted = await prisma.whatsAppConversationMessage.findUnique({ where: { id: conversation.messages[1].id } });
  assert.equal(accepted.deliveryStatus, 'ACCEPTED');

  const timestamp = String(Math.floor(scope.clock.now().getTime() / 1000));
  for (const status of ['sent', 'delivered', 'read']) {
    assert.equal(await delivery.applyStatus({ id: accepted.providerMessageId, status, timestamp }), true);
  }
  assert.equal(await delivery.applyStatus({ id: accepted.providerMessageId, status: 'sent', timestamp }), true);
  const read = await prisma.whatsAppConversationMessage.findUnique({ where: { id: accepted.id } });
  assert.equal(read.deliveryStatus, 'READ');
  assert.ok(read.providerTimestamp instanceof Date);

  const failedMessage = await prisma.whatsAppConversationMessage.create({
    data: {
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      messageType: 'TEXT',
      body: 'Synthetic permanent failure',
      deliveryStatus: 'QUEUED',
      idempotencyKey: `nva-it-failed.${runId}.${randomUUID()}`,
    },
  });
  deliveryDiagnostics.rememberFixture(failedMessage);
  scope.clock.observeFixture(failedMessage);
  let permanentFailureSends = 0;
  const failingDelivery = createWhatsAppConversationDeliveryService({
    client: prisma,
    configProvider,
    now: scope.clock.now,
    sender: async () => {
      permanentFailureSends += 1;
      throw Object.assign(new Error('Synthetic permanent failure'), { retryable: false, code: 'SYNTHETIC_PERMANENT' });
    },
  });
  assert.deepEqual(await failingDelivery.sendMessage(failedMessage.id), { failed: true, retryable: false });
  const failed = await prisma.whatsAppConversationMessage.findUnique({ where: { id: failedMessage.id } });
  assert.equal(failed.deliveryStatus, 'FAILED');
  assert.equal(failed.failureCode, 'SYNTHETIC_PERMANENT');
  assert.equal(failed.attempts, 1);
  assert.deepEqual(await failingDelivery.sendMessage(failedMessage.id), { skipped: true });
  const stillFailed = await prisma.whatsAppConversationMessage.findUnique({ where: { id: failedMessage.id } });
  assert.equal(stillFailed.deliveryStatus, 'FAILED');
  assert.equal(stillFailed.attempts, 1);
  assert.equal(permanentFailureSends, 1);

  const { PrismaClient } = require('@prisma/client');
  const freshClient = new PrismaClient({ datasources: { db: { url: explicitTestUrl.toString() } } });
  try {
    await freshClient.$connect();
    await verifyDatabaseIdentity(freshClient);
    const persisted = await freshClient.whatsAppConversation.findUnique({ where: { id: conversation.id }, include: { messages: true } });
    assert.equal(persisted.phoneNumber, scope.phoneNumber);
    assert.equal(persisted.messages.length, 3);
    assert.equal(persisted.messages.find((message) => message.id === accepted.id).deliveryStatus, 'READ');
    assert.equal(persisted.messages.find((message) => message.id === failedMessage.id).deliveryStatus, 'FAILED');
  } finally {
    await freshClient.$disconnect();
  }
});

test('PostgreSQL deduplicates concurrent copies of one inbound provider event', async () => {
  const scope = await newScope();
  const providerMessageId = `wamid.nva-it.concurrent.${runId}.${randomUUID()}`;
  const results = await Promise.all([
    scope.inbound('Bonjour', providerMessageId),
    scope.inbound('Bonjour', providerMessageId),
  ]);
  assert.equal(results.filter((result) => result.duplicate).length, 1);
  assert.equal(results.filter((result) => !result.duplicate).length, 1);
  assert.deepEqual(results.map((result) => result.duplicate).sort(), [false, true]);
  assert.deepEqual(results.map((result) => result.queuedResponses).sort(), [0, 1]);
  const created = results.find((result) => !result.duplicate);
  assert.ok(created, 'Concurrent calls must return exactly one non-duplicate result.');
  const conversationId = created.conversationId;
  assert.ok(Number.isSafeInteger(conversationId) && conversationId > 0, 'Non-duplicate result must contain a valid conversation id.');
  const conversation = await prisma.whatsAppConversation.findUnique({ where: { id: conversationId }, select: { id: true, phoneNumber: true } });
  assert.ok(conversation, 'The non-duplicate result must reference a persisted conversation.');
  assert.equal(conversation.phoneNumber, scope.phoneNumber);
  const inboundCount = await prisma.whatsAppConversationMessage.count({ where: { providerMessageId } });
  assert.equal(inboundCount, 1);
  assert.equal(await prisma.whatsAppConversationMessage.count({ where: { conversationId, direction: 'OUTBOUND' } }), 1);
});

test('PostgreSQL records consent, schedules 24h and 72h follow-ups, then records opt-out and cancels pending rows', async () => {
  const scope = await newScope();
  await scope.inbound('Je veux connaître les formations');
  await scope.inbound('Je veux apprendre l’anglais');
  await scope.inbound('OUI RELANCES');

  const consent = await prisma.whatsAppCommercialConsentEvent.findFirst({
    where: { conversationId: scope.conversationId, decision: 'GRANTED' },
  });
  assert.ok(consent);
  assert.equal(consent.scope, 'COMMERCIAL_FOLLOW_UPS');
  assert.equal(consent.source, 'WHATSAPP_INBOUND');
  assert.ok(consent.evidenceProviderMessageId);
  let rows = await prisma.whatsAppProspectFollowUp.findMany({ where: { conversationId: consent.conversationId }, orderBy: { sequenceHours: 'asc' } });
  assert.deepEqual(rows.map((row) => row.sequenceHours), [24, 72]);
  assert.ok(rows.every((row) => row.status === 'PENDING'));

  const followUpProviderId = `wamid.nva-it.follow-up.${randomUUID()}`;
  assert.equal(await scope.followUps.applyStatus({ id: followUpProviderId, status: 'sent', biz_opaque_callback_data: rows[0].deduplicationKey, timestamp: String(Math.floor(Date.now() / 1000)) }), true);
  assert.equal(await scope.followUps.applyStatus({ id: followUpProviderId, status: 'delivered', biz_opaque_callback_data: rows[0].deduplicationKey, timestamp: String(Math.floor(Date.now() / 1000)) }), true);
  rows = await prisma.whatsAppProspectFollowUp.findMany({ where: { conversationId: consent.conversationId }, orderBy: { sequenceHours: 'asc' } });
  assert.equal(rows[0].status, 'DELIVERED');
  assert.equal(rows[1].status, 'PENDING');
  assert.equal(await scope.followUps.applyStatus({
    id: `wamid.nva-it.follow-up-failed.${randomUUID()}`,
    status: 'failed',
    errors: [{ code: 'SYNTHETIC_TEMPLATE_FAILURE' }],
    biz_opaque_callback_data: rows[1].deduplicationKey,
    timestamp: String(Math.floor(Date.now() / 1000)),
  }), true);
  rows = await prisma.whatsAppProspectFollowUp.findMany({ where: { conversationId: consent.conversationId }, orderBy: { sequenceHours: 'asc' } });
  assert.deepEqual(rows.map((row) => row.status), ['DELIVERED', 'FAILED']);
  assert.equal(rows[1].failureCode, 'SYNTHETIC_TEMPLATE_FAILURE');

  await scope.inbound('ARRET');
  const events = await prisma.whatsAppCommercialConsentEvent.findMany({ where: { conversationId: consent.conversationId }, orderBy: { id: 'asc' } });
  assert.deepEqual(events.map((event) => event.decision), ['GRANTED', 'REVOKED']);
  const stopped = await prisma.whatsAppConversation.findUnique({ where: { id: consent.conversationId } });
  assert.equal(stopped.controlState, 'OPTED_OUT');
  rows = await prisma.whatsAppProspectFollowUp.findMany({ where: { conversationId: consent.conversationId } });
  assert.deepEqual(rows.sort((a, b) => a.sequenceHours - b.sequenceHours).map((row) => row.status), ['DELIVERED', 'CANCELLED']);
});

test('PostgreSQL takeover cancels queued replies and relances and is visible through admin queries', async () => {
  const scope = await newScope();
  const advisor = await createSyntheticAdvisor();
  await scope.inbound('Je veux connaître les formations');
  await scope.inbound('Je veux apprendre l’anglais');
  await scope.inbound('OUI RELANCES');
  const conversation = await prisma.whatsAppConversation.findUnique({ where: { phoneNumber: scope.phoneNumber } });
  assert.ok(conversation);

  await scope.conversationService.takeOverConversation(conversation.id, advisor.id);
  const state = await prisma.whatsAppConversation.findUnique({ where: { id: conversation.id } });
  assert.equal(state.controlState, 'HUMAN_TAKEOVER');
  assert.equal(state.assignedAdvisorId, advisor.id);
  const queued = await prisma.whatsAppConversationMessage.count({ where: { conversationId: conversation.id, deliveryStatus: 'CANCELLED' } });
  assert.ok(queued > 0);
  const followUps = await prisma.whatsAppProspectFollowUp.findMany({ where: { conversationId: conversation.id } });
  assert.equal(followUps.length, 2);
  assert.ok(followUps.every((row) => row.status === 'CANCELLED'));

  const admin = createWhatsAppConversationAdminService({ client: prisma });
  const handoffs = await admin.list('handoff');
  assert.ok(handoffs.conversations.some((row) => row.id === conversation.id));
  const detail = await admin.get(conversation.id);
  assert.equal(detail.assignedAdvisor.id, advisor.id);
  assert.deepEqual(detail.messages.map((message) => message.createdAt.getTime()), [...detail.messages.map((message) => message.createdAt.getTime())].sort((a, b) => a - b));
});

function fixtureCatalog() {
  return [
    { id: 101, slug: 'test-general', title: 'Anglais général', pricingActive: true, pricingMode: 'ONE_TIME', price: 137, currency: 'USD', upcomingSessionCount: 1,
      structureType: 'SIMPLE', accessPolicy: 'LEGACY_STAGED', session: { id: 201, weekDays: ['Lundi'], startTime: '18:00', endTime: '19:30', registrationGroups: [] } },
    { id: 102, slug: 'test-affaires', title: 'Anglais des affaires', pricingActive: true, pricingMode: 'ONE_TIME', price: 283, currency: 'USD', upcomingSessionCount: 1 },
  ];
}
function humanService(scope) {
  return createWhatsAppHumanHandoffService({ client: prisma, configProvider, now: scope.clock.now, audit: () => {} });
}
async function queuedReply(scope, text = 'Bonjour') {
  await scope.inbound(text);
  const row = await prisma.whatsAppConversationMessage.findFirst({ where: { conversationId: scope.conversationId, direction: 'OUTBOUND', deliveryStatus: 'QUEUED' }, orderBy: { id: 'desc' } });
  assert.ok(row, 'Synthetic reply must be queued.');
  scope.clock.observeFixture(row);
  deliveryDiagnostics.rememberFixture(row);
  return row;
}

test('PostgreSQL contextual state survives client disconnect and fresh service restart', async () => {
  const courses = fixtureCatalog();
  const scope = await newScope({ catalogCourses: courses, registrationCourses: courses });
  await scope.inbound('Je veux apprendre l’anglais');
  await scope.inbound('Anglais général');
  await scope.inbound('prix');
  const before = await prisma.whatsAppConversation.findUnique({ where: { id: scope.conversationId } });
  assert.equal(before.engineState.selectedCourseId, 101); assert.equal(before.engineState.lastIntent, 'PRICE');
  const { PrismaClient } = require('@prisma/client');
  const fresh = new PrismaClient({ datasources: { db: { url: explicitTestUrl.toString() } } });
  try {
    await fresh.$connect(); await verifyDatabaseIdentity(fresh); await fresh.$disconnect(); await fresh.$connect(); await verifyDatabaseIdentity(fresh);
    const restarted = createWhatsAppConversationService({ client: fresh,
      catalog: { listPublished: async () => courses }, registration: { listCoursesForPublicRegistration: async () => courses },
      followUpConfig: () => ({}), publicAppUrl: 'https://nva.example.test', now: scope.clock.now,
    });
    await restarted.processInboundMessage({ id: `wamid.restart.${randomUUID()}`, from: scope.phoneNumber.slice(1), timestamp: String(Math.floor(scope.clock.now().getTime() / 1000)), type: 'text', text: { body: 'Et les horaires ?' } });
    const persisted = await fresh.whatsAppConversation.findUnique({ where: { id: scope.conversationId }, include: { messages: { orderBy: { id: 'desc' }, take: 1 } } });
    assert.equal(persisted.engineState.selectedCourseId, 101); assert.equal(persisted.engineState.lastIntent, 'SCHEDULE');
    assert.equal(persisted.engineState.qualification.objective, 'Je veux apprendre l’anglais'); assert.match(persisted.messages[0].body, /18:00–19:30/);
  } finally { await fresh.$disconnect(); }
});

test('PostgreSQL uniqueness rejects a duplicated outbound key without adding a message', async () => {
  const scope = await newScope(); const row = await queuedReply(scope);
  await assert.rejects(prisma.whatsAppConversationMessage.create({ data: { conversationId: scope.conversationId, direction: 'OUTBOUND', body: 'duplicate', idempotencyKey: row.idempotencyKey, deliveryStatus: 'QUEUED' } }), error => error.code === 'P2002');
  assert.equal(await prisma.whatsAppConversationMessage.count({ where: { idempotencyKey: row.idempotencyKey } }), 1);
});

test('PostgreSQL concurrent administrators permit exactly one assignment and preserve authorization', async () => {
  const scope = await newScope(); await scope.inbound('Bonjour');
  const first = await createSyntheticAdvisor(); const second = await createSyntheticAdvisor(); const student = await createSyntheticAdvisor({ role: 'STUDENT' });
  const human = humanService(scope);
  const results = await Promise.allSettled([human.takeOver(scope.conversationId, first.id), human.takeOver(scope.conversationId, second.id)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.statusCode, 409);
  const conversation = await prisma.whatsAppConversation.findUnique({ where: { id: scope.conversationId } });
  assert.equal(conversation.controlState, 'HUMAN_TAKEOVER');
  const loser = conversation.assignedAdvisorId === first.id ? second.id : first.id;
  await assert.rejects(human.queueManualReply(scope.conversationId, loser, 'Unauthorized ownership', randomUUID()), { statusCode: 409 });
  await assert.rejects(human.queueManualReply(scope.conversationId, student.id, 'Unauthorized role', randomUUID()), { statusCode: 403 });
  assert.equal(await prisma.whatsAppConversationMessage.count({ where: { conversationId: scope.conversationId, messageType: 'SYSTEM', senderUserId: { not: null } } }), 1);
});

test('PostgreSQL two workers claim a single message and make only one simulated send', async () => {
  const scope = await newScope(); const message = await queuedReply(scope); let sends = 0;
  const makeWorker = () => createWhatsAppConversationDeliveryService({ client: prisma, configProvider, now: scope.clock.now,
    sender: async () => { sends += 1; return { providerMessageId: `wamid.workers.${runId}.${randomUUID()}` }; } });
  const results = await Promise.all([makeWorker().sendMessage(message.id), makeWorker().sendMessage(message.id)]);
  assert.equal(sends, 1); assert.equal(results.filter(result => result.accepted).length, 1); assert.equal(results.filter(result => result.skipped).length, 1);
  const stored = await prisma.whatsAppConversationMessage.findUnique({ where: { id: message.id } });
  assert.equal(stored.attempts, 1); assert.equal(stored.deliveryStatus, 'ACCEPTED'); assert.ok(stored.providerMessageId);
});

test('PostgreSQL unique handoff acknowledgement and manual reply preserve human state and history', async () => {
  const scope = await newScope(); const advisor = await createSyntheticAdvisor(); const eventId = `wamid.handoff.${randomUUID()}`;
  assert.equal((await scope.inbound('conseiller', eventId)).queuedResponses, 1);
  assert.equal((await scope.inbound('conseiller', eventId)).duplicate, true);
  const ackKey = `wa-handoff:${eventId}:0`;
  assert.equal(await prisma.whatsAppConversationMessage.count({ where: { idempotencyKey: ackKey } }), 1);
  const ack = await prisma.whatsAppConversationMessage.findUnique({ where: { idempotencyKey: ackKey } });
  scope.clock.observeFixture(ack);
  let sends = 0;
  const worker = createWhatsAppConversationDeliveryService({ client: prisma, configProvider, now: scope.clock.now, sender: async () => ({ providerMessageId: `wamid.human.${++sends}.${randomUUID()}` }) });
  await worker.sendMessage(ack.id); assert.equal(sends, 1);
  await scope.inbound('prix');
  assert.equal(await prisma.whatsAppConversationMessage.count({ where: { conversationId: scope.conversationId, deliveryStatus: 'QUEUED' } }), 0);
  const human = humanService(scope); await human.takeOver(scope.conversationId, advisor.id);
  const submission = randomUUID();
  const replies = await Promise.all([human.queueManualReply(scope.conversationId, advisor.id, 'Synthetic manual reply', submission), human.queueManualReply(scope.conversationId, advisor.id, 'Synthetic manual reply', submission)]);
  assert.equal(replies.filter(reply => reply.duplicate).length, 1);
  assert.equal(replies[0].message.id, replies[1].message.id);
  const manual = replies[0].message; assert.equal(manual.senderUserId, advisor.id);
  scope.clock.observeFixture(manual);
  await worker.sendMessage(manual.id); assert.equal(sends, 2);
  const stored = await prisma.whatsAppConversationMessage.findUnique({ where: { id: manual.id } }); assert.equal(stored.deliveryStatus, 'ACCEPTED'); assert.equal(stored.attempts, 1);
});

test('PostgreSQL return to chatbot cancels queued manual text without retroactive automatic replies', async () => {
  const courses = fixtureCatalog(); const scope = await newScope({ catalogCourses: courses, registrationCourses: courses });
  const advisor = await createSyntheticAdvisor(); await scope.inbound('Anglais général');
  const human = humanService(scope); await human.takeOver(scope.conversationId, advisor.id); await scope.inbound('horaires');
  const reply = await human.queueManualReply(scope.conversationId, advisor.id, 'Pending manual message', randomUUID());
  const count = await prisma.whatsAppConversationMessage.count({ where: { conversationId: scope.conversationId, deliveryStatus: 'QUEUED' } }); assert.equal(count, 1);
  await human.resume(scope.conversationId, advisor.id); let sends = 0;
  const worker = createWhatsAppConversationDeliveryService({ client: prisma, configProvider, now: scope.clock.now, sender: async () => { sends += 1; throw new Error('Cancelled message must never transmit'); } });
  assert.deepEqual(await worker.sendMessage(reply.message.id), { skipped: true }); assert.equal(sends, 0);
  const after = await prisma.whatsAppConversation.findUnique({ where: { id: scope.conversationId } });
  assert.equal(after.controlState, 'BOT_ACTIVE'); assert.equal(after.engineState.selectedCourseId, 101);
  assert.equal(await prisma.whatsAppConversationMessage.count({ where: { conversationId: scope.conversationId, deliveryStatus: 'QUEUED' } }), 0);
  await scope.inbound('prix'); assert.equal(await prisma.whatsAppConversationMessage.count({ where: { conversationId: scope.conversationId, deliveryStatus: 'QUEUED' } }), 1);
});

test('PostgreSQL uncertain send has no retry and a late callback reconciles without a second attempt', async () => {
  const scope = await newScope(); const message = await queuedReply(scope); let sends = 0;
  const worker = createWhatsAppConversationDeliveryService({ client: prisma, configProvider, now: scope.clock.now, sender: async () => { sends += 1; throw Object.assign(new Error('Synthetic lost response'), { code: 'DELIVERY_UNCERTAIN', uncertain: true }); } });
  assert.deepEqual(await worker.sendMessage(message.id), { failed: true, retryable: false });
  assert.deepEqual(await worker.sendMessage(message.id), { skipped: true }); assert.equal(sends, 1);
  const late = { id: `wamid.late.${randomUUID()}`, status: 'delivered', biz_opaque_callback_data: message.idempotencyKey };
  assert.equal(await worker.applyStatus(late), true); assert.equal(await worker.applyStatus(late), true);
  await worker.applyStatus({ ...late, status: 'sent' }); await worker.applyStatus({ ...late, status: 'failed' });
  const stored = await prisma.whatsAppConversationMessage.findUnique({ where: { id: message.id } });
  assert.equal(stored.deliveryStatus, 'DELIVERED'); assert.equal(stored.failureCode, null); assert.equal(stored.attempts, 1); assert.equal(sends, 1);
});

test('PostgreSQL confirmed temporary rejection respects deadline and retry limit', async () => {
  const scope = await newScope(); const message = await queuedReply(scope); let sends = 0;
  const worker = createWhatsAppConversationDeliveryService({ client: prisma, configProvider, now: scope.clock.now, sender: async () => { sends += 1; throw Object.assign(new Error('Synthetic rate limit'), { code: '429', retryable: true, acceptanceRejected: true, uncertain: false }); } });
  assert.deepEqual(await worker.sendMessage(message.id), { failed: true, retryable: true });
  assert.deepEqual(await worker.sendMessage(message.id), { skipped: true }); assert.equal(sends, 1);
  // Advance test time to the persisted backoff deadline; never rewrite the row.
  let retryDeadline = await prisma.whatsAppConversationMessage.findUnique({ where: { id: message.id }, select: { updatedAt: true } });
  scope.clock.advanceTo(retryDeadline.updatedAt);
  assert.deepEqual(await worker.sendMessage(message.id), { failed: true, retryable: true });
  retryDeadline = await prisma.whatsAppConversationMessage.findUnique({ where: { id: message.id }, select: { updatedAt: true } });
  scope.clock.advanceTo(retryDeadline.updatedAt);
  assert.deepEqual(await worker.sendMessage(message.id), { failed: true, retryable: false });
  assert.deepEqual(await worker.sendMessage(message.id), { skipped: true });
  const stored = await prisma.whatsAppConversationMessage.findUnique({ where: { id: message.id } }); assert.equal(stored.deliveryStatus, 'FAILED'); assert.equal(stored.attempts, 3); assert.equal(sends, 3);
});

test('PostgreSQL callback received before HTTP completion and concurrent status updates preserve READ', async () => {
  const scope = await newScope(); const message = await queuedReply(scope); const providerId = `wamid.early.${randomUUID()}`;
  const callback = createWhatsAppConversationDeliveryService({ client: prisma, configProvider, now: scope.clock.now });
  const worker = createWhatsAppConversationDeliveryService({ client: prisma, configProvider, now: scope.clock.now, sender: async () => {
    await callback.applyStatus({ id: providerId, status: 'delivered', biz_opaque_callback_data: message.idempotencyKey }); return { providerMessageId: providerId };
  } });
  assert.deepEqual(await worker.sendMessage(message.id), { accepted: true, statusRecordedByWebhook: true });
  await Promise.all([callback.applyStatus({ id: providerId, status: 'read' }), callback.applyStatus({ id: providerId, status: 'sent' })]);
  assert.equal((await prisma.whatsAppConversationMessage.findUnique({ where: { id: message.id } })).deliveryStatus, 'READ');
});

test('PostgreSQL STOP persists revocation, blocks manual sending and isolates another conversation', async () => {
  const scope = await newScope(); const other = await newScope(); const advisor = await createSyntheticAdvisor();
  await scope.inbound('Je veux apprendre l’anglais'); await scope.inbound('OUI RELANCES'); await other.inbound('Bonjour');
  const human = humanService(scope); await human.takeOver(scope.conversationId, advisor.id);
  const manual = await human.queueManualReply(scope.conversationId, advisor.id, 'Pending before STOP', randomUUID());
  await scope.inbound('STOP');
  await assert.rejects(human.queueManualReply(scope.conversationId, advisor.id, 'Forbidden', randomUUID()), { statusCode: 409 });
  await assert.rejects(human.resume(scope.conversationId, advisor.id), { statusCode: 409 });
  assert.equal((await prisma.whatsAppConversationMessage.findUnique({ where: { id: manual.message.id } })).deliveryStatus, 'CANCELLED');
  const consents = await prisma.whatsAppCommercialConsentEvent.findMany({ where: { conversationId: scope.conversationId }, orderBy: { id: 'asc' } });
  assert.deepEqual(consents.map(event => event.decision), ['GRANTED', 'REVOKED']);
  const unrelated = await prisma.whatsAppConversation.findUnique({ where: { id: other.conversationId }, include: { messages: true } });
  assert.equal(unrelated.controlState, 'BOT_ACTIVE'); assert.equal(unrelated.messages.length, 2);
  assert.ok(unrelated.messages.every(row => row.conversationId === other.conversationId));
});
