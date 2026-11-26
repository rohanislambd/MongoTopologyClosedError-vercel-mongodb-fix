# Next.js + Better Auth + MongoDB (Vercel) — `MongoTopologyClosedError` সমাধান গাইড

Vercel-এর Serverless পরিবেশে **Next.js + Better Auth + MongoDB** ব্যবহার করলে প্রায়ই `MongoTopologyClosedError` বা অযাচিত সেশন/রিডাইরেক্ট সমস্যা দেখা দেয়। এই রিপোজিটরিতে সমস্যাটি **কেন হয়**, **কীভাবে স্থায়ীভাবে ঠিক করবেন**, এবং **A-to-Z কী কী ইন্সটল ও কনফিগার করতে হবে** তার সম্পূর্ণ গাইড দেওয়া হলো।

---

## সূচিপত্র

- [১. সমস্যাটি কেন হয়?](#১-সমস্যাটি-কেন-হয়)
- [২. Localhost বনাম Vercel: সাধারণ `betterAuth()` কেন Vercel-এ কাজ করে না?](#২-localhost-বনাম-vercel-সাধারণ-betterauth-কেন-vercel-এ-কাজ-করে-না)
- [৩. A-to-Z ইনস্টলেশন ও প্রজেক্ট সেটআপ](#৩-a-to-z-ইনস্টলেশন-ও-প্রজেক্ট-সেটআপ)
- [৪. প্রস্তাবিত ফোল্ডার স্ট্রাকচার](#৪-প্রস্তাবিত-ফোল্ডার-স্ট্রাকচার)
- [৫. সমাধানের কোড ইমপ্লিমেন্টেশন](#৫-সমাধানের-কোড-ইমপ্লিমেন্টেশন)
- [৬. এনভায়রনমেন্ট ভেরিয়েবল ও MongoDB Atlas সেটআপ](#৬-এনভায়রনমেন্ট-ভেরিয়েবল-ও-mongodb-atlas-সেটআপ)
- [৭. ডিপ্লয়মেন্ট ও ডিবাগিং চেকলিস্ট](#৭-ডিপ্লয়মেন্ট-ও-ডিবাগিং-চেকলিস্ট)

---

## ১. সমস্যাটি কেন হয়?

1. **Serverless Freeze/Resume:** Vercel-এ প্রতিটি রিকোয়েস্ট শেষ হলে Serverless ফাংশন ফ্রিজ (suspend) হয়ে যায়। ফ্রিজ অবস্থায় বা মাঝপথে `MongoClient`-এর টপোলজি বন্ধ হয়ে গেলে পরের রিকোয়েস্টে `MongoTopologyClosedError` আসে।
2. **মৃত `MongoClient` আটকে থাকা:** সাধারণভাবে `export const auth = betterAuth(...)` দিলে টপোলজি ক্লোজ হওয়ার পরও `auth` পুরোনো বন্ধ ক্লায়েন্ট ধরে রাখে এবং নতুন কানেকশন তৈরি করতে পারে না।
3. **`proxy.ts` / `middleware.ts`-এ সরাসরি DB কল:** `proxy.ts` (বা Next.js 15-এর `middleware.ts`) আলাদা আইসোলেটেড কনটেক্সটে চলে। সেখানে সরাসরি `@/lib/auth` ইমপোর্ট করলে আলাদা `MongoClient` খুলে টপোলজি ক্র্যাশ বা এরর তৈরি করে।
4. **`getSessionCookie` এর সীমাবদ্ধতা:** `getSessionCookie` শুধু ব্রাউজারে কুকি আছে কি না তা দেখে—সেশনটি ডাটাবেজে বৈধ বা এক্সপায়ার্ড কি না তা যাচাই করে না। ফলে এক্সপায়ার্ড কুকি থাকলে `/sign-in` বা প্রোটেক্টেড রুটে লুপ/ব্লক তৈরি হতে পারে।

---

## ২. Localhost বনাম Vercel: সাধারণ `betterAuth()` কেন Vercel-এ কাজ করে না?

সাধারণত আমরা অফিসিয়াল ডকুমেন্টেশন দেখে যেভাবে লিখি:
```ts
// ❌ সাধারণ সেটআপ (Localhost-এ চলে, কিন্তু Vercel-এ ক্র্যাশ করে)
import { betterAuth } from "better-auth";
import { MongoClient } from "mongodb";
import { mongodbAdapter } from "@better-auth/mongo-adapter";

const client = new MongoClient("mongodb://localhost:27017/database");
const db = client.db();

export const auth = betterAuth({
  database: mongodbAdapter(db, {
    client,
  }),
});
```

| তুলনার বিষয় | Localhost (`npm run dev` / `start`) | Vercel (Serverless Functions) |
| :--- | :--- | :--- |
| **সার্ভারের ধরন** | সার্বক্ষণিক চালু থাকা (Long-running) Node.js প্রসেস। | ইভেন্ট-ভিত্তিক Serverless ফাংশন (কাজ শেষে ফ্রিজ/বন্ধ হয়)। |
| **কানেকশন লাইফসাইকেল** | `MongoClient` একবার কানেক্ট হয়ে সবসময় জীবিত থাকে এবং ব্যাকগ্রাউন্ডে হার্টবিট পাঠায়। | রেসপন্স পাঠানোর পরপরই কনটেইনার **ফ্রিজ (Suspend)** হয়; তখন MongoDB-র সাথে TCP সকেট কেটে টপোলজি ক্লোজ হয়ে যায়। |
| **পরবর্তী রিকোয়েস্ট** | একই জীবিত কানেকশন পুল নির্বিঘ্নে ব্যবহার হয়। | ফ্রিজ হওয়া কনটেইনার আবার জেগে উঠলে পুরোনো `auth` ইনস্ট্যান্স **মৃত `MongoClient`** ধরে রাখে এবং `MongoTopologyClosedError` দেয়। |
| **অটো-রিকভারি** | প্রসেস বন্ধ না হলে সাধারণত টপোলজি ক্লোজই হয় না, তাই রিকভারির দরকার পড়ে না। | সাধারণ `export const auth` একবার তৈরি হলে আর রিসেট হয় না; তাই `topologyClosed` ইভেন্টে ক্যাশ ক্লিয়ার + `Proxy` প্যাটার্ন লাগে। |
| **IP ও নেটওয়ার্ক** | আপনার পিসির নির্দিষ্ট নেটওয়ার্ক থেকে সরাসরি MongoDB Atlas-এ হিট করে। | Vercel-এর ডাইনামিক IP ব্যবহার হয়, তাই Atlas-এ `0.0.0.0/0` না থাকলে কানেক্টই করতে পারে না। |

**সংক্ষেপে:** Localhost-এ আপনার সার্ভার কখনো ফ্রিজ হয় না বলে সাধারণ `betterAuth()` কোনো ঝামেলা ছাড়াই চলে। কিন্তু Vercel-এ ফাংশন ফ্রিজ-রিজিউম হওয়ার কারণে মৃত কানেকশন আটকে যায়—যার একমাত্র স্থায়ী সমাধান হলো **Auto-Recovering `MongoClient` + `Proxy` + `attachDatabasePool`**।

---

## ৩. A-to-Z ইনস্টলেশন ও প্রজেক্ট সেটআপ

### পূর্বশর্ত (Prerequisites)
- **Node.js** `v18.18+` বা `v20+`
- **Next.js** প্রজেক্ট (App Router) — `proxy.ts` ব্যবহারের জন্য **Next.js 16+** (অথবা Next.js 15 হলে `middleware.ts`)
- **MongoDB Atlas** অ্যাকাউন্ট ও একটি ক্লাস্টার
- **Vercel** অ্যাকাউন্ট (ডিপ্লয়মেন্টের জন্য)

### ধাপ ১: প্রয়োজনীয় প্যাকেজ ইনস্টল করুন

একটি নতুন Next.js প্রজেক্ট তৈরি করতে চাইলে (ঐচ্ছিক):

```bash
npx create-next-app@latest my-app --typescript --app --src-dir
cd my-app
```

এবার মূল প্যাকেজগুলো ইনস্টল করুন:

```bash
npm install better-auth mongodb @better-auth/mongo-adapter @vercel/functions
```

> **প্যাকেজগুলোর কাজ:**
> - `better-auth`: অথেনটিকেশন ফ্রেমওয়ার্ক
> - `mongodb`: অফিসিয়াল MongoDB Node.js ড্রাইভার (`MongoClient`)
> - `@better-auth/mongo-adapter`: Better Auth-কে MongoDB-এর সাথে যুক্ত করার অ্যাডাপ্টার
> - `@vercel/functions`: Serverless ফাংশনে `attachDatabasePool` দিয়ে DB পুল সঠিকভাবে ম্যানেজ করার জন্য

*(আপনি চাইলে `pnpm add` অথবা `yarn add` ব্যবহার করতে পারেন।)*

---

## ৪. প্রস্তাবিত ফোল্ডার স্ট্রাকচার

```text
my-app/
├── src/
│   ├── lib/
│   │   └── auth.ts                         # Auto-recovering MongoClient + Proxy auth instance
│   ├── app/
│   │   └── api/
│   │       └── auth/
│   │           └── [...all]/
│   │               └── route.ts            # Better Auth API Route Handler
│   └── proxy.ts                            # রুট প্রোটেকশন (Next.js 16+; 15 হলে middleware.ts)
├── .env.local                              # লোকাল এনভায়রনমেন্ট ভেরিয়েবল
└── package.json
```

---

## ৫. সমাধানের কোড ইমপ্লিমেন্টেশন

### ধাপ ১: `src/lib/auth.ts` (Auto-Recovering MongoClient + Proxy)

এখানে `globalThis`-এ ক্লায়েন্ট ক্যাশ করা হয়েছে এবং `topologyClosed` বা `close` ইভেন্ট ফায়ার হলে ক্যাশ ক্লিয়ার করে অটো-রিকভারি করা হয়েছে। পাশাপাশি `toNextJsHandler` সঠিকভাবে কাজ করার জন্য `Proxy`-তে `has` ট্র্যাপ যুক্ত করা হয়েছে।

> সম্পূর্ণ কোড দেখুন: [`auth.ts`](./auth.ts)

```ts
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
```

---

### ধাপ ২: `src/app/api/auth/[...all]/route.ts` (API Handler)

Better Auth-এর API রুট হ্যান্ডলার সেটআপ করুন যাতে `/api/auth/get-session` সহ সব অথেনটিকেশন এন্ডপয়েন্ট কাজ করে:

```ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { POST, GET } = toNextJsHandler(auth);
```

---

### ধাপ ৩: `src/proxy.ts` (সরাসরি `auth` ইমপোর্ট না করে API দিয়ে সেশন চেক)

> সম্পূর্ণ কোড দেখুন: [`proxy.ts`](./proxy.ts)  
> *(নোট: আপনি যদি Next.js 15 বা তার নিচের ভার্সন ব্যবহার করেন, তবে ফাইলটির নাম `src/middleware.ts` এবং ফাংশনের নাম `export async function middleware(...)` দিন।)*

```ts
import { NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  let session: { user?: unknown } | null = null;
  try {
    const res = await fetch(`${request.nextUrl.origin}/api/auth/get-session`, {
      headers: {
        cookie: request.headers.get("cookie") || "",
      },
      cache: "no-store",
    });
    if (res.ok) {
      session = await res.json();
    }
  } catch {
    session = null;
  }

  const isAuthRoute = pathname === "/sign-in" || pathname === "/sign-up";
  const isProtectedRoute =
    pathname.startsWith("/dashboard") || pathname.startsWith("/payment");

  if (session?.user && isAuthRoute) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!session?.user && isProtectedRoute) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard",
    "/dashboard/:path*",
    "/payment",
    "/payment/:path*",
    "/sign-in",
    "/sign-up",
  ],
};
```

---

## ৬. এনভায়রনমেন্ট ভেরিয়েবল ও MongoDB Atlas সেটআপ

### `.env.local` ফাইল তৈরি করুন

প্রজেক্টের রুটে `.env.local` ফাইল তৈরি করে নিচের ভেরিয়েবলগুলো যোগ করুন:

```env
MONGODB_URI="mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<your-db-name>?retryWrites=true&w=majority"
BETTER_AUTH_SECRET="your-random-32-char-secret-key"
BETTER_AUTH_URL="http://localhost:3000"
```

> সিক্রেট কী জেনারেট করতে টার্মিনালে চালাতে পারেন: `openssl rand -base64 32`

### MongoDB Atlas Network Access
1. **MongoDB Atlas** ড্যাশবোর্ডে যান → **Security** → **Network Access**।
2. **Add IP Address** থেকে **`0.0.0.0/0` (Allow Access from Anywhere)** যোগ করে **Active** রাখুন। (Vercel-এর ডাইনামিক IP-র কারণে এটি না থাকলে `MongoServerSelectionError` আসবে)।

---

## ৭. ডিপ্লয়মেন্ট ও ডিবাগিং চেকলিস্ট

ডিপ্লয় করার পর কোনো সমস্যা হলে নিচের বিষয়গুলো পরপর চেক করুন:

- [ ] **MongoDB Atlas Network Access:** `0.0.0.0/0` স্ট্যাটাস **Active** আছে কি না।
- [ ] **Vercel Environment Variables:** Vercel ড্যাশবোর্ডে `MONGODB_URI`, `BETTER_AUTH_SECRET` এবং প্রোডাকশন ডোমেইন অনুযায়ী `BETTER_AUTH_URL` (যেমন `https://your-app.vercel.app`) সঠিকভাবে সেট করা আছে কি না।
- [ ] **`proxy.ts`-এ `getSessionCookie` এড়িয়ে চলা:** `getSessionCookie` শুধু কুকি আছে কি না দেখে—সেশন এক্সপায়ার্ড কি না দেখে না। তাই `/sign-in` ব্লক হওয়া এড়াতে `/api/auth/get-session` ফেচ ব্যবহার করুন।
- [ ] **Client Component-এ `router.refresh()`:** Optimistic UI (যেমন টগল/এডিট মোডাল) ব্যবহার করলে অপ্রয়োজনীয় `router.refresh()` দেবেন না, নইলে প্রতিবার `proxy.ts` ট্রিগার হয়ে অযাচিত রিডাইরেক্ট হতে পারে।
