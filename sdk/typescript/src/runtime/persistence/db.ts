import { PrismaClient } from '@prisma/client';

// PrismaClient is attached to the `global` object in development to prevent
// exhausting your database connection limit.
const globalForPrisma = global as unknown as { prisma?: PrismaClient };

const SETUP = 'The task database is not set up. It is needed only for human tasks kept in a database (awa task, the tasks API). '
    + 'Generate its client once with: npx prisma generate --schema node_modules/agentic-workflow-architecture/prisma/schema.prisma '
    + '(and create the tables with "npx prisma db push --schema <the same file>"). Everything else in the SDK works without it.';

/**
 * The database client, created when it is first used and not when the SDK is loaded: a program
 * that runs workflows, journeys or measures must not need a database, nor fail to start without one.
 *
 * AWA_DATABASE_URL points the SDK at another database, e.g. "file:/var/lib/awa/awa.db".
 * The test suite uses it so that tests never write to the database in the repository.
 */
function client(): PrismaClient {
    if (globalForPrisma.prisma) return globalForPrisma.prisma;
    const url = process.env.AWA_DATABASE_URL;
    let created: PrismaClient;
    try {
        created = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
    } catch (error) {
        throw new Error(`${SETUP} (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`);
    }
    globalForPrisma.prisma = created;
    return created;
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
    get(_target, property) {
        const real = client() as unknown as Record<string | symbol, unknown>;
        const value = real[property];
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(real) : value;
    },
});
