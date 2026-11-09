# 💈 DONIYOR BARBER — TELEGRAM BOT & SUPABASE

Doniyor Barber sartaroshxonasi uchun mustaqil, qulay va to‘liq avtomatlashtirilgan **Telegram Booking Bot**.

Bot mijozlarga hech qanday web saytga kirmasdan, to‘g‘ridan-to‘g‘ri Telegram orqali qulay vaqtni band qilish imkonini beradi. Barcha ma’lumotlar **Supabase (PostgreSQL)** bulutli ma’lumotlar bazasida xavfsiz saqlanadi.

---

## 🌟 Asosiy Imkoniyatlar

1. **📅 Navbat olish (Interactive Booking):**
   * 7 kunlik interaktiv kalendar (Bugun, Ertaga va hafta kunlari).
   * 30 daqiqalik oraliqlar (09:00 — 21:00).
   * Jonli holat: 🟢 Bo‘sh vaqtlar / 🔴 Band vaqtlar.
   * To‘qnashuvlarga qarshi himoya: 2 kishi bir vaqtni band qila olmaydi (Supabase PostgreSQL Unique constraint).

2. **📋 Mening bronlarim:**
   * Mijoz o‘zining barcha faol navbatlarini, kodi va sanasini ko‘rishi mumkin.
   * Bir tugma bilan bronni bekor qilish imkoniyati (bekor qilingan vaqt shu zahoti boshqalarga ochiladi).

3. **🔔 Avtomatik eslatmalar:**
   * Bron tasdiqlanganda chipta yuboriladi.
   * Belgilangan vaqtdan oldin eslatma ko‘rsatiladi.

4. **ℹ️ Ma’lumot:**
   * Manzil: Urganch tuman
   * Ish tartibi: Har kuni 09:00 — 21:00
   * Telefon: +998 90 123 45 67

---

## 🛠 Texnologiyalar

* **Bot:** Node.js (Telegram Bot API - Long Polling Engine)
* **Ma’lumotlar bazasi:** Supabase (Cloud PostgreSQL)
* **Cloud Health Server:** Port 3000 (Render.com / Railway / Koyeb 24/7 bepul hosting uchun)

---

## 🚀 Ishga Tushirish

### 1. Dasturni ishga tushirish:
```bash
npm start
```

### 2. Bulutda 24/7 bepul ishlatish (Render.com):
1. [Render.com](https://render.com) ga kiring.
2. **New +** -> **Web Service** tanlang.
3. Repozitoriyani ulab:
   * **Build Command:** `npm install`
   * **Start Command:** `node bot.js`
4. Tayyor! Bot 24 soat to‘xtovsiz ishlaydi.
