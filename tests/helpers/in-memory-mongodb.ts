import { ObjectId } from 'mongodb';

type Document = Record<string, unknown>;
type Update = {
  $set?: Document;
  $setOnInsert?: Document;
  $push?: Document;
};

function sameValue(left: unknown, right: unknown) {
  if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
  return left === right;
}

function matches(document: Document, filter: Document): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or' && Array.isArray(expected)) {
      return expected.some(clause => matches(document, clause as Document));
    }
    const actual = document[key];
    if (expected && typeof expected === 'object' && !(expected instanceof ObjectId)) {
      const operators = expected as Document;
      if ('$gte' in operators && (actual === undefined || String(actual) < String(operators.$gte))) return false;
      if ('$lte' in operators && (actual === undefined || String(actual) > String(operators.$lte))) return false;
      if ('$ne' in operators && sameValue(actual, operators.$ne)) return false;
      if ('$regex' in operators) {
        const flags = operators.$options === 'i' ? 'i' : '';
        if (typeof actual !== 'string' || !new RegExp(String(operators.$regex), flags).test(actual)) return false;
      }
      if ('$not' in operators && actual && typeof actual === 'object') {
        const inner = operators.$not as Document;
        if ('$elemMatch' in inner && Array.isArray(actual) && actual.some(item => matches(item as Document, inner.$elemMatch as Document))) return false;
      }
      if ('$elemMatch' in operators && Array.isArray(actual) && !actual.some(item => matches(item as Document, operators.$elemMatch as Document))) return false;
      if ('$exists' in operators && Boolean(actual !== undefined) !== Boolean(operators.$exists)) return false;
      if (Object.keys(operators).some(operator => operator.startsWith('$'))) return true;
    }
    return sameValue(actual, expected);
  });
}

function compare(left: unknown, right: unknown) {
  const a = left instanceof ObjectId ? left.toString() : String(left ?? '');
  const b = right instanceof ObjectId ? right.toString() : String(right ?? '');
  return a.localeCompare(b, undefined, { numeric: true });
}

export function installInMemoryMongo() {
  const data = new Map<string, Document[]>();
  const documentsFor = (name: string) => {
    if (!data.has(name)) data.set(name, []);
    return data.get(name)!;
  };

  const database = {
    collection(name: string) {
      const documents = documentsFor(name);
      return {
        findOne: async (filter: Document) => documents.find(item => matches(item, filter)) ?? null,
        countDocuments: async (filter: Document) => documents.filter(item => matches(item, filter)).length,
        find(filter: Document) {
          let found = documents.filter(item => matches(item, filter));
          const cursor = {
            sort(sortSpec: Document) {
              const [field, direction] = Object.entries(sortSpec)[0] || [];
              if (field) {
                found = [...found].sort((left, right) => compare(left[field], right[field]) * Number(direction));
              }
              return cursor;
            },
            limit(count: number) {
              found = found.slice(0, count);
              return cursor;
            },
            async next() {
              return found[0] ?? null;
            },
            async toArray() {
              return [...found];
            }
          };
          return cursor;
        },
        async insertOne(document: Document) {
          const insertedId = document._id instanceof ObjectId ? document._id : new ObjectId();
          documents.push({ ...document, _id: insertedId });
          return { acknowledged: true, insertedId };
        },
        async insertMany(items: Document[]) {
          const insertedIds = Object.fromEntries(items.map((document, index) => {
            const insertedId = document._id instanceof ObjectId ? document._id : new ObjectId();
            documents.push({ ...document, _id: insertedId });
            return [index, insertedId];
          }));
          return { acknowledged: true, insertedCount: items.length, insertedIds };
        },
        async updateOne(filter: Document, update: Update, options?: { upsert?: boolean }) {
          const current = documents.find(item => matches(item, filter));
          if (current) {
            Object.assign(current, update.$set);
            for (const [field, value] of Object.entries(update.$push || {})) {
              const items = Array.isArray(current[field]) ? current[field] as unknown[] : [];
              current[field] = [...items, value];
            }
            return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
          }
          if (options?.upsert) {
            const base = Object.fromEntries(Object.entries(filter).filter(([, value]) =>
              value === null || typeof value !== 'object'
            ));
            const insertedId = typeof filter._id === 'string' ? filter._id : new ObjectId();
            const inserted = { ...base, ...update.$setOnInsert, ...update.$set, _id: insertedId };
            documents.push(inserted);
            return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
          }
          return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        },
        async deleteOne(filter: Document) {
          const index = documents.findIndex(item => matches(item, filter));
          if (index < 0) return { acknowledged: true, deletedCount: 0 };
          documents.splice(index, 1);
          return { acknowledged: true, deletedCount: 1 };
        },
        async deleteMany(filter: Document) {
          const remaining = documents.filter(item => !matches(item, filter));
          const deletedCount = documents.length - remaining.length;
          documents.splice(0, documents.length, ...remaining);
          return { acknowledged: true, deletedCount };
        },
        async createIndex() {
          return 'in-memory-index';
        }
      };
    }
  };

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__conicMongoDb');
  Object.defineProperty(globalThis, '__conicMongoDb', {
    configurable: true,
    writable: true,
    value: database
  });
  return {
    documents: (collection: string) => documentsFor(collection),
    restore() {
      if (descriptor) Object.defineProperty(globalThis, '__conicMongoDb', descriptor);
      else Reflect.deleteProperty(globalThis, '__conicMongoDb');
    }
  };
}
