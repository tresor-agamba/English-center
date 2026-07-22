function configureLocalDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  try {
    const parsedUrl = new URL(databaseUrl);
    const isLocal = ['localhost', '127.0.0.1'].includes(parsedUrl.hostname);

    if (isLocal && !parsedUrl.searchParams.has('sslmode')) {
      parsedUrl.searchParams.set('sslmode', 'disable');
      process.env.DATABASE_URL = parsedUrl.toString();
    }
  } catch {
    // Prisma fournira le message approprié si DATABASE_URL est mal formée.
  }
}

module.exports = { configureLocalDatabaseUrl };
