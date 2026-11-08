import { MongoClient, Db } from 'mongodb';

declare global {
  // eslint-disable-next-line no-var
  var __conicMongoClient: MongoClient | undefined;
  // eslint-disable-next-line no-var
  var __conicMongoDb: Db | undefined;
}

const uri = process.env.MONGODB_URI ?? '';
const dbName = process.env.MONGODB_DB || 'conic_truck2';
if (dbName !== 'conic_truck2') throw new Error('MONGODB_DB must be conic_truck2 for this application.');

if (!uri) throw new Error('MONGODB_URI is not configured. Copy .env.example to .env.local.');

export async function getDb(): Promise<Db> {
  if (global.__conicMongoDb) return global.__conicMongoDb;
  if (!global.__conicMongoClient) global.__conicMongoClient = new MongoClient(uri, { appName: 'CONIC-Truck-2' });
  await global.__conicMongoClient.connect();
  global.__conicMongoDb = global.__conicMongoClient.db(dbName);
  return global.__conicMongoDb;
}
