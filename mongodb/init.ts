import { MongoClient } from 'mongodb';
import { loadConicEnv } from '../scripts/load-env';
import schema from './schema.json';

async function main() {
  loadConicEnv();
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'conic_truck2';
  if (dbName !== 'conic_truck2') throw new Error('MONGODB_DB must be conic_truck2 for this application.');

  if (!uri) {
    throw new Error('Set MONGODB_URI before running database initialization.');
  }

  const client = new MongoClient(uri, { appName: 'CONIC-init' });

  try {
    await client.connect();
    const db = client.db(dbName);

    for (const [name, def] of Object.entries<any>(schema)) {
      const exists = (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;

      if (!exists) {
        await db.createCollection(name, {
          validator: def.validator,
          validationLevel: 'strict',
          validationAction: 'error'
        });
      } else {
        try {
          await db.command({
            collMod: name,
            validator: def.validator,
            validationLevel: 'strict',
            validationAction: 'error'
          });
        } catch (error) {
          console.warn(`Could not update validator for ${name}:`, error);
        }
      }

      for (const index of def.indexes || []) {
        const { key, options } = index.key ? index : { key: index, options: undefined };
        await db.collection(name).createIndex(key, options);
      }
    }

    console.log(`CONIC MongoDB initialized successfully in database "${dbName}".`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
