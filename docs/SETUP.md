# সেটআপ নির্দেশিকা (ধাপে ধাপে)

সময় লাগবে প্রায় ৩০–৪৫ মিনিট। তিনটি অংশ: **(ক)** Google, **(খ)** GitHub, **(গ)** প্রথম লগইন ও ডেটা মাইগ্রেশন।

> **পরামর্শ:** ডেটা রাখার জন্য একটি আলাদা Google অ্যাকাউন্ট (যেমন `company.efbms@gmail.com`) ব্যবহার করুন। সব Sheet/Drive ফাইল এই অ্যাকাউন্টের মালিকানায় থাকবে এবং কোনোটিই public হবে না।

---

## (ক) Google সেটআপ

### ১. Apps Script প্রজেক্ট তৈরি
1. সেই Google অ্যাকাউন্টে লগইন করে <https://script.google.com> খুলুন → **New project**।
2. নাম দিন `EFBMS Gateway`।
3. বাম মেনুতে **Project Settings (⚙)** → **“Show "appsscript.json" manifest file in editor”** চালু করুন।

### ২. কোড বসান
লোকাল কম্পিউটারে একবার `npm ci && npm run gas:bundle` চালান। এতে `gas-dist/` ফোল্ডারে দুটি ফাইল হবে:
1. Editor-এ `appsscript.json` খুলুন → পুরো লেখা মুছে `gas-dist/appsscript.json`-এর লেখা পেস্ট করুন → Save।
2. `Code.gs` খুলুন → পুরো লেখা মুছে `gas-dist/Code.gs`-এর লেখা পেস্ট করুন → Save (Ctrl+S)।

(বিকল্প: `apps-script/` ফোল্ডারের ৯টি `.gs` ফাইল আলাদা আলাদা ফাইল হিসেবে যোগ করা যায়, অথবা `clasp push` ব্যবহার করুন।)

### ৩. Script Properties (প্রাথমিক অ্যাডমিন)
**Project Settings → Script properties → Add script property**:

| Property | মান | বাধ্যতামূলক |
|---|---|---|
| `INITIAL_ADMIN_EMAIL` | প্রথম Super Admin-এর ইমেইল | হ্যাঁ |
| `INITIAL_ADMIN_PASSWORD` | অস্থায়ী পাসওয়ার্ড (≥ ৮ অক্ষর; `password`, `demo123` ইত্যাদি সাধারণ পাসওয়ার্ড গ্রহণযোগ্য নয়) | হ্যাঁ |
| `ADMIN_ALERT_EMAIL` | ব্যাকআপ ব্যর্থ হলে এই ঠিকানায় ইমেইল যাবে | ঐচ্ছিক |

`setup()` চলার পর পাসওয়ার্ড property **স্বয়ংক্রিয়ভাবে মুছে যায়**। প্রথম লগইনে আপনাকে নতুন পাসওয়ার্ড দিতে বাধ্য করা হবে।

### ৪. `setup` চালান
1. Editor-এর উপরের ফাংশন-তালিকা থেকে **`setup`** বাছুন → **Run**।
2. প্রথমবার অনুমতি চাইবে: **Review permissions** → আপনার অ্যাকাউন্ট → *“Google hasn't verified this app”* দেখালে **Advanced → Go to EFBMS Gateway (unsafe)** → **Allow**। (এটি আপনার নিজের স্ক্রিপ্ট, তাই নিরাপদ; এটি Sheets, Drive ও ইমেইল পাঠানোর অনুমতি চায়।)
3. Execution log-এ দেখবেন: Drive folders ready, Spreadsheet created, Sheets created…, Initial admin created।
4. যাচাই: Drive-এ `Website_Data/` ফোল্ডার আছে (ভিতরে `Projects`, `Material_Images`, `Database_Backups`, `System_Backups`, `System_Data`) এবং `System_Data`-তে `EFBMS_Database` Sheet আছে (২৩টি tab)।

### ৫. দৈনিক স্বয়ংক্রিয় ব্যাকআপ চালু
ফাংশন-তালিকা থেকে **`installTriggers`** বাছুন → Run। (প্রতিদিন রাত ২–৩টায় `scheduledBackup` চলবে। একাধিকবার চালালেও একটিই trigger থাকে।)

### ৬. Web App ডেপ্লয়
1. উপরে ডানে **Deploy → New deployment** → ⚙ **Select type → Web app**।
2. **Execute as: Me** · **Who has access: Anyone** → **Deploy**।
3. যে **Web app URL** (`https://script.google.com/macros/s/…/exec`) পাবেন তা কপি করুন।

> **কেন “Anyone”?** আপনার ব্যবহারকারীদের Google অ্যাকাউন্ট থাকতে হবে না, ব্রাউজার থেকে সরাসরি কল করা যাবে। URL জানলেও কিছু দেখা যায় না: প্রতিটি অনুরোধে অ্যাপের নিজস্ব সাইন-করা সেশন টোকেন লাগে, এবং সব অনুমতি সার্ভারে যাচাই হয়। Sheet/Drive কখনও public হয় না। বিস্তারিত: [SECURITY.md](SECURITY.md)।

4. ব্রাউজারে সেই URL খুলুন — এমন লেখা দেখবেন: `{"ok":true,"data":{"service":"ElectroFlow BMS","version":"1.0.0","ready":true}}`। `ready:false` হলে ধাপ ৪ আবার চালান।

**কোড বদলালে:** Deploy → **Manage deployments** → ✏ → Version: **New version** → Deploy (URL একই থাকে)। কলাম যোগ হয়েছে এমন আপডেটের পর একবার `upgradeSchema` চালান।

---

## (খ) GitHub সেটআপ

### ১. রিপোজিটরি ও পুশ
```bash
cd electroflow-bms-pages          # এই প্রজেক্টের ফোল্ডার
git init -b main
git add .
git commit -m "ElectroFlow BMS: GitHub Pages + Google Sheets/Drive"
# GitHub-এ খালি রিপোজিটরি বানান (যেমন electroflow-bms), তারপর:
git remote add origin https://github.com/<আপনার-ইউজারনেম>/electroflow-bms.git
git push -u origin main
```
> রিপোজিটরিতে কোনো secret নেই, তাই public রাখা নিরাপদ। (GitHub Free প্ল্যানে Pages শুধু public রিপোজিটরির জন্য; private-এ Pages-এর জন্য paid প্ল্যান লাগে।)

### ২. Pages চালু
**Settings → Pages → Build and deployment → Source: GitHub Actions**।

### ৩. গেটওয়ে URL দিন
**Settings → Secrets and variables → Actions → Variables → New repository variable**
- Name: `GAS_URL` · Value: (ক-৬ ধাপের `/exec` URL)

(এটি *variable*, *secret* নয় — URL প্রকাশ্য। workflow URL-এর ফরম্যাট যাচাই করে `dist/config.js`-এ লিখে দেয়।)
বিকল্প: `public/config.js`-এ `gasUrl` লিখে commit করুন।

### ৪. ডেপ্লয়
`main`-এ push করলেই **Actions → Deploy to GitHub Pages** চলে (টেস্ট → বিল্ড → ডেপ্লয়)। শেষে সাইট পাবেন:
`https://<ইউজারনেম>.github.io/<রিপোজিটরি>/`

আপডেট করতে: কোড বদলান → `git push`।

### 404 / refresh সমস্যা কেন হবে না
* সব asset path relative (`base: './'`) — `/<repo>/` সাব-পাথে বা কাস্টম ডোমেইনে একইভাবে চলে।
* নেভিগেশন URL-এর hash-এ থাকে (`#/projects/<id>/boq`), তাই refresh বা সরাসরি লিংক খুললে GitHub কখনও “অজানা পাথ” দেখে না।
* বিল্ডে `404.html` (index-এর কপি) ও `.nojekyll` যুক্ত হয়।

---

## (গ) প্রথম লগইন, ইউজার ও ডেটা

1. সাইট খুলে `INITIAL_ADMIN_EMAIL` ও অস্থায়ী পাসওয়ার্ড দিয়ে লগইন করুন → নতুন পাসওয়ার্ড দিন।
2. **Settings → Users**: ইউজার যোগ করুন (সিস্টেম একটি এলোমেলো অস্থায়ী পাসওয়ার্ড তৈরি করে দেখায়; প্রথম লগইনে ব্যবহারকারী তা বদলাবে)।
3. প্রজেক্ট খুলে **Overview → Team access**-এ নির্ধারণ করুন কে কোন প্রজেক্ট দেখতে পাবে (মালিক ও Super Admin ছাড়া শুধু সদস্যরা)।

### পুরোনো ডেটা মাইগ্রেশন
1. **আগে পুরোনো `db/custom.db`-এর একটি কপি নিরাপদে রাখুন** (ব্যাকআপ)।
2. JSON তৈরি:
   ```bash
   python3 scripts/export-sqlite.py /path/to/custom.db -o efbms-export.json
   ```
   (শুধু ম্যাটেরিয়াল লাইব্রেরি/সাপ্লায়ার/ডিজাইন রুল চাইলে `--library-only` যোগ করুন; নতুন শুরুর জন্য তৈরি ফাইল: `migration/starter-library.json`।)
3. নতুন সাইটে Super Admin হিসেবে **Settings → Backup & Data → Data migration → Choose export file**।
   * আমদানির আগে স্বয়ংক্রিয়ভাবে বর্তমান অবস্থার safety backup নেওয়া হয়।
   * মূল ID অক্ষুণ্ণ থাকে, ফলে প্রজেক্ট→ফ্লোর→রুম→পয়েন্ট, ম্যাটেরিয়াল→ছবি ইত্যাদি সম্পর্ক ঠিক থাকে।
   * পুনরায় চালালে আগের রেকর্ড skip হয় (ডুপ্লিকেট হয় না)।
   * শেষে সারণি দেখায় (ফাইলে কয়টি / তৈরি / skip / error) ও Integrity check চলে।
4. পুরোনো ইউজার মাইগ্রেট হয় না (পুরোনো পাসওয়ার্ড হ্যাশ দুর্বল ছিল) — ইউজার নতুন করে তৈরি করুন।
5. প্রজেক্টের মালিক হবেন যিনি import করছেন; তারপর Team access-এ সদস্য যোগ করুন।

### Drive-এর ফোল্ডার কাঠামো (স্বয়ংক্রিয়)
```
Website_Data/
  Projects/<কোড>_<projectId>/{Drawings, Images, Documents, Reports}
  Material_Images/
  Database_Backups/        ← <backupId>.json.gz
  System_Backups/FileMirror/   ← প্রতিটি ফাইলের স্বতন্ত্র কপি
  System_Data/ (EFBMS_Database Sheet, Blobs/)
```

### ব্যাকআপ ও রিস্টোর (Admin)
**ড্যাশবোর্ডের উপরে** (Super Admin-এর জন্য) সর্বশেষ সফল ব্যাকআপের সময় ও সতর্কতা দেখায়; ক্লিক করলে **Settings → Backup & Data** খোলে: সর্বশেষ সফল ব্যাকআপের সময়, দৈনিক schedule চালু আছে কি না, ব্যর্থ হলে লাল সতর্কতা, **Backup now**, ইতিহাস, **Verify**, **Restore**।
Restore: আগে checksum/ফাইল যাচাই → নিশ্চিতকরণ কোড + `RESTORE` লিখে নিশ্চিত → স্বয়ংক্রিয় safety backup → ডেটা প্রতিস্থাপন → হারানো Drive ফাইল mirror কপি থেকে পুনর্নির্মাণ → সম্পর্ক যাচাই রিপোর্ট। Audit log ও Backup ইতিহাস restore-এ মুছে যায় না।

## সমস্যা হলে
| লক্ষণ | কারণ/সমাধান |
|---|---|
| “Backend is not connected yet” | `GAS_URL` variable / `public/config.js` ফাঁকা বা ভুল |
| “unexpected page… access Anyone” | Web app “Anyone” নয়, বা URL `/exec` দিয়ে শেষ হয়নি, বা নতুন version deploy হয়নি |
| `NOT_SETUP` | `setup()` চালানো হয়নি |
| `SCHEMA_MISMATCH` | Sheet-এর হেডার হাতে বদলানো হয়েছে; আসল কলাম-ক্রম ফিরিয়ে `upgradeSchema` চালান |
| `BUSY` | একসাথে অনেক লেখা; কয়েক সেকেন্ড পর আবার চেষ্টা (অ্যাপ নিজেই Retry দেখায়) |
| Quota exceeded | Apps Script দৈনিক সীমা — পরদিন স্বাভাবিক; অনেক ব্যবহারকারী হলে আলাদা Workspace অ্যাকাউন্ট বিবেচনা করুন |
