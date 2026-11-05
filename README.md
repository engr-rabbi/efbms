# ElectroFlow BMS — GitHub Pages + Google Sheets + Google Drive

আগের Next.js/Prisma/SQLite ওয়েবসাইটটি এখন একটি **স্ট্যাটিক React (Vite) অ্যাপ**, যার

| অংশ | কোথায় থাকে | খরচ |
|---|---|---|
| ফ্রন্টএন্ড (এই রিপোজিটরি) | **GitHub Pages** | বিনামূল্যে |
| ডেটাবেজ (প্রজেক্ট, ফ্লোর, রুম, ম্যাটেরিয়াল, BOQ, কোটেশন, ইউজার, অডিট লগ …) | **Google Sheets** | বিনামূল্যে |
| ছবি, ড্রয়িং, ডকুমেন্ট, রিপোর্ট, ব্যাকআপ | **Google Drive** (প্রাইভেট) | বিনামূল্যে (১৫ GB) |
| নিরাপদ গেটওয়ে (লগইন, অনুমতি, ভ্যালিডেশন, ব্যাকআপ) | **Google Apps Script Web App** | বিনামূল্যে |

কোনো paid hosting/database লাগে না। রিপোজিটরিতে কোনো API key, password, OAuth secret বা service-account নেই।

```
ব্রাউজার (GitHub Pages)                       Google (আপনার অ্যাকাউন্ট)
┌──────────────────────────┐   HTTPS + সাইন-করা    ┌───────────────────────────────┐
│ React UI                 │   সেশন টোকেন          │ Apps Script Web App (গেটওয়ে) │
│ estimation / BOQ ইঞ্জিন   │ ───────────────────▶ │  • লগইন, RBAC, প্রজেক্ট-মেম্বারশিপ │
│ table cache + pending    │                       │  • validation, rate-limit, লক   │
│ queue (offline সুরক্ষা)   │ ◀─────────────────── │  • audit log, backup/restore   │
└──────────────────────────┘                       └──────────┬──────────┬──────────┘
                                                              ▼          ▼
                                                        Google Sheets  Google Drive
```

## দ্রুত শুরু
1. **[docs/SETUP.md](docs/SETUP.md)** — Google ও GitHub সেটআপের ধাপে ধাপে নির্দেশনা (এটিই প্রধান গাইড)।
2. [docs/SHEETS_SCHEMA.md](docs/SHEETS_SCHEMA.md) — প্রতিটি Sheet/Tab ও কলামের সংজ্ঞা (কোড থেকে স্বয়ংক্রিয়ভাবে তৈরি)।
3. [docs/SECURITY.md](docs/SECURITY.md) — নিরাপত্তা মডেল, অনুমতি ম্যাট্রিক্স, সীমাবদ্ধতা।
4. [docs/TESTING.md](docs/TESTING.md) — স্বয়ংক্রিয় টেস্ট কী প্রমাণ করে, আর আপনাকে লাইভে কী যাচাই করতে হবে (checklist)।
5. [docs/CHANGES.md](docs/CHANGES.md) — আগের সাইটের সাথে আচরণগত পার্থক্য ও জানা সীমাবদ্ধতা।
6. **[docs/USER_MANUAL.md](docs/USER_MANUAL.md) — সম্পূর্ণ ধাপে-ধাপে ইউজার ম্যানুয়াল ও হিসাব-নির্দেশিকা** (প্রজেক্ট তৈরি → ফ্লোর প্ল্যান → এস্টিমেট → BOQ → কোটেশন → রিপোর্ট; সূত্র ও আসল সংখ্যার উদাহরণসহ)। অ্যাপের ভেতরেও আছে: বামে মেনু **সহায়তা / ইউজার ম্যানুয়াল** (সূচি, সার্চ, Print/Save PDF)।

## কমান্ড
```bash
npm ci
npm run dev          # লোকাল ডেভেলপমেন্ট
npm test             # ৩৩টি টেস্ট (Apps Script লজিক, পূর্ণ API প্রবাহ, মাইগ্রেশন, CSV, ম্যানুয়াল-বনাম-ইঞ্জিন)
npm run build        # টাইপ-চেক + প্রোডাকশন বিল্ড → dist/ (+ .nojekyll, 404.html)
npm run gas:bundle   # apps-script/*.gs → gas-dist/Code.gs (এক ফাইলে পেস্ট করার জন্য)
npm run migrate:export -- path/to/custom.db   # পুরোনো SQLite → JSON
```

## ফোল্ডার
```
src/                 React অ্যাপ (UI অক্ষুণ্ণ) + src/lib/backend/ (নতুন ডেটা স্তর)
apps-script/         Google Apps Script গেটওয়ে সম্পূর্ণ সোর্স (*.gs) + appsscript.json
scripts/             export-sqlite.py (মাইগ্রেশন), bundle-gas.mjs, gen-schema-doc.mjs, postbuild.mjs
migration/           starter-library.json (৮৩টি ম্যাটেরিয়াল, সাপ্লায়ার, ডিজাইন রুল, কোম্পানি তথ্য)
tests/               Google সার্ভিসের mock + টেস্ট-স্যুট + পুরোনো ডেমো ডেটার এক্সপোর্ট (fixture)
docs/manual/         ম্যানুয়ালের অধ্যায়-ফাইল (USER_MANUAL.md এগুলো জুড়ে তৈরি)
public/config.js     গেটওয়ে URL (গোপন নয়) — এখানেই বসান
.github/workflows/   GitHub Pages-এ স্বয়ংক্রিয় ডেপ্লয়
docs/                বাংলা নির্দেশিকা
```
