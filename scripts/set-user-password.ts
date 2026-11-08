import { loadConicEnv } from './load-env';
import { hashPassword } from '../lib/auth';
import { getDb } from '../lib/mongodb';
import { BUSINESS_ID } from '../lib/constants';

async function main() {
  loadConicEnv();
  const email = process.env.AUTH_SETUP_EMAIL?.trim().toLowerCase();
  const password = process.env.AUTH_SETUP_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error('Set AUTH_SETUP_EMAIL and AUTH_SETUP_PASSWORD (at least 12 characters) before running this script.');
  }

  const db = await getDb();
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const result = await db.collection('users').updateOne(
    { businessId: BUSINESS_ID, email: { $regex: `^${escapedEmail}$`, $options: 'i' } },
    { $set: { passwordHash: await hashPassword(password), updatedAt: new Date() } }
  );
  if (!result.matchedCount) throw new Error(`No existing user found for ${email}. Create the user record before setting its password.`);
  console.log(`Password updated for ${email}.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Could not set user password.');
  process.exitCode = 1;
});
