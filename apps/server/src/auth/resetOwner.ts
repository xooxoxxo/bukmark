import { getDb, type Db } from '../db/client.js';
import { owner, sessions, apiTokens, authCodes } from '../db/schema.js';

/** Deletes the owner, every session and every pending authorization code; with revokeTokens also every access token. */
export async function resetOwner(db: Db, { revokeTokens }: { revokeTokens: boolean }) {
  return db.transaction(async (tx) => {
    const owners = await tx.delete(owner).returning({ id: owner.id });
    const deletedSessions = await tx.delete(sessions).returning({ idHash: sessions.idHash });
    const codes = await tx.delete(authCodes).returning({ codeHash: authCodes.codeHash });
    const tokens = revokeTokens ? await tx.delete(apiTokens).returning({ id: apiTokens.id }) : [];
    return { owner: owners.length, sessions: deletedSessions.length, authCodes: codes.length, tokens: tokens.length };
  });
}

if (process.argv[1]?.endsWith('resetOwner.ts')) {
  const revokeTokens = process.argv.includes('--revoke-tokens');
  const { db, sql } = getDb();
  try {
    const n = await resetOwner(db, { revokeTokens });
    console.log(n.owner ? 'Deleted the owner password.' : 'There was no owner password.');
    console.log(`Deleted ${n.sessions} session(s) and ${n.authCodes} pending authorization code(s).`);
    console.log(revokeTokens
      ? `Deleted ${n.tokens} access token(s).`
      : 'Access tokens were kept and keep working, including the extension\'s. Run again with --revoke-tokens to delete them.');
    console.log('Open the web app now and set a new password.');
  } catch (err) {
    console.error('Error resetting owner:', err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
