import { PrismaClient } from '@prisma/client';

// PrismaClient is attached to the `global` object in development to prevent
// exhausting your database connection limit.

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// AWA_DATABASE_URL points the SDK at another database, e.g. "file:/var/lib/awa/awa.db".
// The test suite uses it so that tests never write to the database in the repository.
const url = process.env.AWA_DATABASE_URL;

export const db = globalForPrisma.prisma || new PrismaClient(url ? { datasources: { db: { url } } } : undefined);

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
