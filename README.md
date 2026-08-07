# Cube Rush — تحويل اللعبة لملف APK

المشروع ده جاهز ومظبوط بـ **Capacitor** — ده الأداة اللي بتاخد أي لعبة/موقع HTML وتحوّله لتطبيق أندرويد حقيقي. فيه طريقتين، اختار اللي يناسبك:

---

## 🅰️ الطريقة الأولى: عن طريق GitHub (الأسهل — مش محتاج تنزل حاجة على جهازك)

الطريقة دي بتخلي GitHub نفسه يبني الـ APK ليك أوتوماتيك، وانت بس بتنزّله في الآخر.

### الخطوات:
1. اعمل حساب على [github.com](https://github.com) لو معندكش
2. اعمل Repository جديد (زرار **New** الأخضر) — اسمه مثلاً `cube-rush`، خليه **Public**
3. ارفع كل الملفات اللي جوه الفولدر ده (بما فيها فولدر `.github` المخفي!) على الـ Repository — أسهل طريقة: من صفحة الـ Repo دوس **Add file → Upload files** واسحب كل حاجة، أو استخدم Git من الترمينال:
   ```
   git init
   git add .
   git commit -m "Cube Rush"
   git branch -M main
   git remote add origin https://github.com/USERNAME/cube-rush.git
   git push -u origin main
   ```
4. روح لتاب **Actions** فوق في صفحة الريبو — هتلاقي عملية اسمها "Build Cube Rush APK" شغالة لوحدها (أو دوس **Run workflow** لو عايز تشغلها يدوي)
5. استنى 5-10 دقايق لحد ما تخلص (هتلاقي دائرة خضرا ✅ لما تخلص بنجاح)
6. دوس على الـ run اللي خلص، وانزل لتحت لحد قسم **Artifacts** — هتلاقي ملف اسمه `cube-rush-debug-apk` — ده الـ APK بتاعك جاهز للتنزيل والتثبيت

> ⚠️ ملحوظة: الـ APK ده "Debug" — يعني تقدر تثبته على أي تليفون أندرويد وتجربه فورًا، بس مش موقّع بشكل نهائي لرفعه على Google Play. لو عايز تنشره على المتجر، هتحتاج تعمل "Release build" موقّع — قولّي لو وصلت للمرحلة دي وهوريك الخطوات.

---

## 🅱️ الطريقة الثانية: عن طريق Android Studio (على جهازك مباشرة)

### المتطلبات:
- [Node.js](https://nodejs.org) (نسخة 18 أو أحدث)
- [Android Studio](https://developer.android.com/studio) مثبت

### الخطوات:
1. افتح Terminal / CMD جوه فولدر المشروع ده
2. ثبّت المكتبات:
   ```
   npm install
   ```
3. أضف منصة أندرويد (بيتعمل مرة واحدة بس):
   ```
   npx cap add android
   ```
4. زامن ملفات اللعبة مع مشروع أندرويد:
   ```
   npx cap sync android
   ```
5. افتح المشروع في Android Studio:
   ```
   npx cap open android
   ```
6. Android Studio هيفتح المشروع ويعمل Gradle sync لوحده (استنى لحد ما يخلص، ممكن ياخد كام دقيقة أول مرة)
7. من قايمة **Build** فوق، دوس **Build Bundle(s) / APK(s) → Build APK(s)**
8. لما يخلص، هيظهرلك إشعار صغير تحت فيه رابط **locate** — دوس عليه يوديك لمكان الملف (`android/app/build/outputs/apk/debug/app-debug.apk`)

### لو عايز تنشرها على Google Play (نسخة موقّعة):
من نفس قايمة **Build** اختار **Generate Signed Bundle / APK**، واعمل مفتاح توقيع جديد (Keystore) لو معكش واحد بالفعل — احتفظ بيه في مكان آمن لأنك هتحتاجه لكل تحديث جاي للعبة.

---

## هيكل المشروع

```
cube-rush-capacitor/
├── www/                      ← كل ملفات اللعبة (Phaser 3) هنا
│   ├── index.html
│   ├── style.css
│   ├── Config.js, Storage.js, ...
│   └── scenes/
├── capacitor.config.json     ← إعدادات التطبيق (الاسم، الـ package id، لون الخلفية)
├── package.json
└── .github/workflows/build-apk.yml   ← عملية البناء الأوتوماتيكي على GitHub
```

## تغيير اسم التطبيق أو الـ Package ID
افتح `capacitor.config.json` وغيّر:
- `appId`: معرّف التطبيق الفريد (مهم جدًا لو هتنشر على Play — لازم يكون فريد، مثلاً `com.yourname.cuberush`)
- `appName`: الاسم اللي هيظهر تحت أيقونة اللعبة على التليفون
