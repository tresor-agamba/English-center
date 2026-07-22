const { PrismaClient } = require('@prisma/client');
const { configureLocalDatabaseUrl } = require('./databaseUrl.util');

configureLocalDatabaseUrl();

const prisma = new PrismaClient();

module.exports = prisma;
