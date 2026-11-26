import { betterAuth } from "better-auth";
import { MongoClient, MongoClientOptions } from "mongodb";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { attachDatabasePool } from "@vercel/functions";

// ১. TypeScript-কে globalThis-এর কাস্টম প্রপার্টি চেনানো
declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined;
  // eslint-disable-next-line no-var
  var _authInstance: ReturnType<typeof createAuthInstance> | undefined;
}

// ২. Serverless উপযোগী টাইমআউট ও পুল অপশন
const options: MongoClientOptions = {
  maxPoolSize: 10,
  minPoolSize: 0,
  maxIdleTimeMS: 10000,
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
  socketTimeoutMS: 10000,
};

// ৩. জীবিত MongoClient রিইউজ + ক্লোজ হলে ক্যাশ ক্লিয়ার
function getMongoClient(): MongoClient {
  if (!globalThis._mongoClient) {
    const client = new MongoClient(process.env.MONGODB_URI as string, options);

    const clearCache = () => {
      if (globalThis._mongoClient === client) {
        globalThis._mongoClient = undefined;
        globalThis._authInstance = undefined;
      }
    };
    client.on("topologyClosed", clearCache);
    client.on("close", clearCache);

    // শুধু নতুন client তৈরির সময় একবারই attachDatabasePool কল হবে
    attachDatabasePool(client);
    globalThis._mongoClient = client;
  }

  return globalThis._mongoClient;
}

// ৪. ফ্রেশ Better Auth ইনস্ট্যান্স তৈরি
function createAuthInstance() {
  const client = getMongoClient();
  const db = client.db("your-db-name");

  return betterAuth({
    database: mongodbAdapter(db, { client }),
    // আপনার বাকি emailAndPassword, socialProviders, plugins, session কনফিগ...
  });
}

// ৫. ক্যাশ চেক ও অটো-রিকভারি
function getAuth() {
  if (!globalThis._authInstance) {
    globalThis._authInstance = createAuthInstance();
  }
  return globalThis._authInstance;
}

// ৬. Proxy দিয়ে এক্সপোর্ট (has ট্র্যাপ অবশ্যই লাগবে toNextJsHandler-এর জন্য)
export const auth = new Proxy({} as ReturnType<typeof createAuthInstance>, {
  get(_target, prop) {
    const instance = getAuth();
    const value = Reflect.get(instance, prop, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
  has(_target, prop) {
    return prop in getAuth();
  },
});
