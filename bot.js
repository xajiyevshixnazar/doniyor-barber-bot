import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { getSupabaseBackendClient } from './server/supabaseBackend.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '9237460654:AAFePOyWMn7np-zZ1nc6dfH-uISLeQNFk9Y';
const BASE_URL = `https://api.telegram.org/bot${TOKEN}`;
const DATA_DIR = path.join(__dirname, 'data');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bot_bookings.json');
const WAITLIST_FILE = path.join(DATA_DIR, 'bot_waitlist.json');
const SENT_REMINDERS_FILE = path.join(DATA_DIR, 'sent_reminders.json');

// Admin Telegram ID lari (Talab qilingan 2 ta admin)
const ADMIN_IDS = ['835865320', '5236823441'];

function isAdmin(chatId) {
  if (!chatId) return false;
  return ADMIN_IDS.includes(String(chatId));
}

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Local cache helpers
function loadLocalBookings() {
  try {
    if (fs.existsSync(BOOKINGS_FILE)) {
      const raw = fs.readFileSync(BOOKINGS_FILE, 'utf-8');
      return JSON.parse(raw) || [];
    }
  } catch (e) {
    console.error('Error loading local bookings:', e.message);
  }
  return [];
}

function saveLocalBookings(bookings) {
  try {
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving local bookings:', e.message);
  }
}

function loadWaitlist() {
  try {
    if (fs.existsSync(WAITLIST_FILE)) {
      const raw = fs.readFileSync(WAITLIST_FILE, 'utf-8');
      return JSON.parse(raw) || [];
    }
  } catch (e) {
    console.error('Error loading waitlist:', e.message);
  }
  return [];
}

function saveWaitlist(list) {
  try {
    fs.writeFileSync(WAITLIST_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving waitlist:', e.message);
  }
}

function loadSentReminders() {
  try {
    if (fs.existsSync(SENT_REMINDERS_FILE)) {
      const raw = fs.readFileSync(SENT_REMINDERS_FILE, 'utf-8');
      return new Set(JSON.parse(raw) || []);
    }
  } catch (e) {
    console.error('Error loading sent reminders:', e.message);
  }
  return new Set();
}

function saveSentReminders(set) {
  try {
    fs.writeFileSync(SENT_REMINDERS_FILE, JSON.stringify(Array.from(set)), 'utf-8');
  } catch (e) {
    console.error('Error saving sent reminders:', e.message);
  }
}

const sentReminders = loadSentReminders();

// Telegram API Helper
async function callApi(method, body = {}) {
  try {
    const res = await fetch(`${BASE_URL}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (err) {
    console.error(`API [${method}] error:`, err.message);
    return { ok: false, error: err.message };
  }
}

// O'zbek oylari va kunlari
const UZ_MONTHS = [
  'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'
];
const UZ_MONTHS_SHORT = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyun', 'Iyul', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];
const UZ_DAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const UZ_DAYS_SHORT = ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan'];

function getTashkentDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * 5));
}

function formatDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getUpcomingDays(count = 7) {
  const base = getTashkentDate();
  const list = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const dateStr = formatDateString(d);
    const dayName = UZ_DAYS[d.getDay()];
    const dayShort = UZ_DAYS_SHORT[d.getDay()];
    const dayNum = d.getDate();
    const monthShort = UZ_MONTHS_SHORT[d.getMonth()];
    const monthFull = UZ_MONTHS[d.getMonth()];

    list.push({
      dateStr,
      dayNum,
      monthShort,
      monthFull,
      dayName,
      dayShort,
      isToday: i === 0,
      isTomorrow: i === 1,
      label: i === 0 ? `Bugun (${dayNum} ${monthShort})` : (i === 1 ? `Ertaga (${dayNum} ${monthShort})` : `${dayShort} (${dayNum} ${monthShort})`),
      fullTitle: `${dayNum}-${monthFull}, ${dayName}`
    });
  }
  return list;
}

const TIME_SLOTS = [
  '09:00', '09:30', '10:00',
  '10:30', '11:00', '11:30',
  '12:00', '13:00', '13:30',
  '14:00', '14:30', '15:00',
  '15:30', '16:00', '16:30',
  '17:00', '17:30', '18:00',
  '18:30', '19:00', '19:30',
  '20:00', '20:30', '21:00'
];

function generateBookingCode() {
  return 'RB-' + Math.floor(1000 + Math.random() * 9000);
}

// Global cached settings
let cachedSettings = {
  shop_name: 'Doniyor Barber',
  barber_name: 'Doniyor Barber',
  phone: '+998 90 123 45 67',
  address: 'Urganch tuman',
  price: 80000,
  start_time: '09:00',
  end_time: '21:00'
};

async function syncSettings() {
  const supabase = getSupabaseBackendClient();
  if (supabase) {
    try {
      const { data } = await supabase.from('settings').select('*').eq('id', 'default').single();
      if (data) {
        cachedSettings.shop_name = data.shop_name || cachedSettings.shop_name;
        cachedSettings.barber_name = data.barber_name || cachedSettings.barber_name;
        cachedSettings.phone = data.phone || cachedSettings.phone;
        cachedSettings.address = data.address || cachedSettings.address;
        cachedSettings.start_time = data.start_time || cachedSettings.start_time;
        cachedSettings.end_time = data.end_time || cachedSettings.end_time;
      }
    } catch (e) {}
  }
}
syncSettings();

// User in-memory session for booking
const userSessions = new Map();
// Admin in-memory session for admin interactions
const adminSessions = new Map();

// ====================================================================
// KEYBOARDS
// ====================================================================

// Oddiy mijozlar uchun menyu
const CLIENT_MAIN_KEYBOARD = {
  keyboard: [
    [{ text: '📅 Navbat olish' }, { text: '📋 Mening bronlarim' }],
    [{ text: '🔔 Eslatmalar' }, { text: 'ℹ️ Ma’lumot' }]
  ],
  resize_keyboard: true,
  persistent: true
};

// Adminlar uchun asosiy menyu (Admin panel tugmasi bilan)
const ADMIN_MAIN_KEYBOARD = {
  keyboard: [
    [{ text: '📅 Navbat olish' }, { text: '📋 Mening bronlarim' }],
    [{ text: '🔔 Eslatmalar' }, { text: 'ℹ️ Ma’lumot' }],
    [{ text: '👑 Admin Panel' }]
  ],
  resize_keyboard: true,
  persistent: true
};

// Admin boshqaruv paneli menyusi (8 ta talab qilingan bo'lim)
const ADMIN_PANEL_KEYBOARD = {
  keyboard: [
    [{ text: '📋 Bronlar' }, { text: '📅 Kalendar' }],
    [{ text: '👥 Mijozlar' }, { text: '⏰ Ish vaqti' }],
    [{ text: '🔔 Eslatmalar' }, { text: '⏳ Kutish ro‘yxati' }],
    [{ text: '📊 Statistika' }, { text: '⚙️ Sozlamalar' }],
    [{ text: '◀️ Mijoz rejimiga qaytish' }]
  ],
  resize_keyboard: true,
  persistent: true
};

function getMainKeyboard(chatId) {
  return isAdmin(chatId) ? ADMIN_MAIN_KEYBOARD : CLIENT_MAIN_KEYBOARD;
}

// Start xabari
async function handleStart(chatId, firstName = 'Mijoz') {
  const isAdm = isAdmin(chatId);
  const welcomeText = 
`✂️ *Doniyor Barber Bot* ga xush kelibsiz, *${firstName}*!${isAdm ? '\n👑 _Siz tizimda Admin sifatida aniqlandingiz._' : ''}

Barberxonamizga navbatsiz, o‘zingizga qulay vaqtni onlayn band qiling.

📍 *Manzil:* ${cachedSettings.address}
⏰ *Ish vaqti:* ${cachedSettings.start_time} - ${cachedSettings.end_time}
📞 *Telefon:* ${cachedSettings.phone}

_Kerakli bo‘limni tanlang:_`;

  await callApi('sendMessage', {
    chat_id: chatId,
    text: welcomeText,
    parse_mode: 'Markdown',
    reply_markup: getMainKeyboard(chatId)
  });
}

// ====================================================================
// ADMIN PANEL - 8 TA ASOSIY BO'LIM
// ====================================================================

// Admin Panel Bosh sahifasi
async function handleAdminPanelHome(chatId) {
  if (!isAdmin(chatId)) {
    return callApi('sendMessage', {
      chat_id: chatId,
      text: '⛔ Kechirasiz, sizda Admin huquqi yo‘q.',
      reply_markup: CLIENT_MAIN_KEYBOARD
    });
  }

  adminSessions.delete(chatId);

  const text = 
`👑 *DONIYOR BARBER — PROFESSIONAL ADMIN PANEL*

Quyidagi bo‘limlardan birini tanlang:

• 📋 *Bronlar* — Bugungi va bo‘lajak navbatlar, yakunlash va bekor qilish
• 📅 *Kalendar* — 7 kunlik jadval, vaqtlarni bloklash va ochish
• 👥 *Mijozlar* — CRM mijozlar bazasi, tashriflar tarixi
• ⏰ *Ish vaqti* — Ish boshlanish/tugash va tushlik sozlamalari
• 🔔 *Eslatmalar* — Avto eslatma va ommaviy xabar (Broadcast)
• ⏳ *Kutish ro‘yxati* — Navbat kutayotgan mijozlar ro‘yxati
• 📊 *Statistika* — Bugungi va oylik daromad, bronlar hisoboti
• ⚙️ *Sozlamalar* — Manzil, telefon, narx va tizim sozlamalari`;

  await callApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    reply_markup: ADMIN_PANEL_KEYBOARD
  });
}

// 1. BRONLAR BOSHQARUVI
async function handleAdminBookings(chatId, filter = 'today', messageId = null) {
  if (!isAdmin(chatId)) return;

  const todayStr = formatDateString(getTashkentDate());
  const tomorrow = new Date(getTashkentDate());
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = formatDateString(tomorrow);

  let bookings = [];
  const supabase = getSupabaseBackendClient();

  if (supabase) {
    try {
      let query = supabase.from('bookings').select('*').order('date', { ascending: true }).order('time_slot', { ascending: true });
      if (filter === 'today') {
        query = query.eq('date', todayStr);
      } else if (filter === 'tomorrow') {
        query = query.eq('date', tomorrowStr);
      } else if (filter === 'all_active') {
        query = query.gte('date', todayStr).neq('status', 'cancelled');
      } else if (filter === 'cancelled') {
        query = query.eq('status', 'cancelled').order('created_at', { ascending: false }).limit(10);
      }
      const { data } = await query;
      if (data) bookings = data;
    } catch (e) {
      console.error('Admin bookings query error:', e.message);
    }
  }

  if (bookings.length === 0 && filter === 'today') {
    const all = loadLocalBookings();
    bookings = all.filter(b => b.date === todayStr);
  }

  let title = '📅 *Bugungi bronlar*';
  if (filter === 'tomorrow') title = '🌅 *Ertangi bronlar*';
  if (filter === 'all_active') title = '📑 *Barcha faol bronlar*';
  if (filter === 'cancelled') title = '❌ *Oxirgi bekor qilinganlar*';

  let msgText = `${title} (${bookings.length} ta):\n\n`;

  if (bookings.length === 0) {
    msgText += '_Ushbu filtr bo‘yicha hozircha hech qanday bron topilmadi._\n';
  } else {
    bookings.slice(0, 10).forEach((b, idx) => {
      const code = b.booking_code || b.bookingCode || 'RB-0000';
      const name = b.client_name || b.clientName || 'Mijoz';
      const time = b.time_slot || b.timeSlot;
      const date = b.date_formatted || b.date;
      const statusIcon = b.status === 'completed' ? '✅ Yakunlangan' : (b.status === 'cancelled' ? '❌ Bekor qilingan' : '🟢 Faol');
      const phone = b.client_phone || (b.username ? `@${b.username.replace('@','')}` : 'Tel yo‘q');

      msgText += `${idx + 1}. 🎟 \`${code}\` • ⏰ *${time}* (${date})\n`;
      msgText += `   👤 *${name}* • 📞 ${phone}\n`;
      msgText += `   Holat: ${statusIcon}\n\n`;
    });
  }

  const inlineButtons = [
    [
      { text: filter === 'today' ? '• 📌 Bugun •' : '📌 Bugun', callback_data: 'adm_book_filter_today' },
      { text: filter === 'tomorrow' ? '• 🌅 Ertaga •' : '🌅 Ertaga', callback_data: 'adm_book_filter_tomorrow' }
    ],
    [
      { text: filter === 'all_active' ? '• 📑 Barcha faollar •' : '📑 Barcha faollar', callback_data: 'adm_book_filter_all_active' },
      { text: filter === 'cancelled' ? '• ❌ Bekorlar •' : '❌ Bekorlar', callback_data: 'adm_book_filter_cancelled' }
    ],
    [
      { text: '➕ Yangi bron qo‘shish (Admin bron)', callback_data: 'adm_add_walkin' }
    ]
  ];

  // Agar faol bronlar bo'lsa, tezkor yakunlash/bekor qilish tugmalarini chiqarish
  const activeBookings = bookings.filter(b => b.status === 'confirmed').slice(0, 4);
  if (activeBookings.length > 0) {
    activeBookings.forEach(b => {
      const code = b.booking_code || b.bookingCode;
      const id = b.id;
      inlineButtons.push([
        { text: `✅ Yakunlash: ${code}`, callback_data: `adm_action_complete_${id}` },
        { text: `❌ Bekor qilish: ${code}`, callback_data: `adm_action_cancel_${id}` }
      ]);
    });
  }

  if (messageId) {
    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: msgText,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: inlineButtons }
    });
  } else {
    await callApi('sendMessage', {
      chat_id: chatId,
      text: msgText,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: inlineButtons }
    });
  }
}

// 2. KALENDAR VA VAQTLARNI BLOKLASH
async function handleAdminCalendar(chatId, selectedDateStr = null, messageId = null) {
  if (!isAdmin(chatId)) return;

  const days = getUpcomingDays(7);
  const activeDate = selectedDateStr || days[0].dateStr;
  const activeDay = days.find(d => d.dateStr === activeDate) || days[0];

  const supabase = getSupabaseBackendClient();
  let bookedSlots = [];
  let blockedSlots = [];

  if (supabase) {
    try {
      const { data: dbBookings } = await supabase.from('bookings').select('time_slot, client_name, booking_code').eq('date', activeDate).neq('status', 'cancelled');
      if (dbBookings) bookedSlots = dbBookings;

      const { data: dbBlocked } = await supabase.from('blocked_slots').select('time').eq('date', activeDate);
      if (dbBlocked) blockedSlots = dbBlocked.map(b => b.time);
    } catch (e) {}
  }

  const bookedTimes = bookedSlots.map(b => b.time_slot);

  const dayButtons = [];
  let dayRow = [];
  days.forEach((day, idx) => {
    dayRow.push({
      text: day.dateStr === activeDate ? `• ${day.dayShort} ${day.dayNum} •` : `${day.dayShort} ${day.dayNum}`,
      callback_data: `adm_cal_date_${day.dateStr}`
    });
    if (dayRow.length === 4 || idx === days.length - 1) {
      dayButtons.push(dayRow);
      dayRow = [];
    }
  });

  const slotButtons = [];
  let slotRow = [];

  TIME_SLOTS.forEach((slot, idx) => {
    const isBooked = bookedTimes.includes(slot);
    const isBlocked = blockedSlots.includes(slot);

    let btnText = `🟢 ${slot}`;
    let cb = `adm_slot_click_${activeDate}_${slot}_free`;

    if (isBlocked) {
      btnText = `🚫 ${slot}`;
      cb = `adm_slot_click_${activeDate}_${slot}_blocked`;
    } else if (isBooked) {
      btnText = `🔴 ${slot}`;
      cb = `adm_slot_click_${activeDate}_${slot}_booked`;
    }

    slotRow.push({ text: btnText, callback_data: cb });

    if (slotRow.length === 3 || idx === TIME_SLOTS.length - 1) {
      slotButtons.push(slotRow);
      slotRow = [];
    }
  });

  const msgText = 
`📅 *KALENDAR VA GRAFIK BOSHQARUVI*

Tanlangan sana: *${activeDay.fullTitle}*

🟢 _Bo‘sh vaqt_ (Bosib bloklash mumkin)
🚫 _Bloklangan vaqt_ (Bosib ochish mumkin)
🔴 _Band qilingan_ (Mijoz bron qilgan)

_Vaqt ustiga bosib, uni bloklash yoki ochishingiz mumkin:_`;

  const keyboard = [...dayButtons, ...slotButtons];

  if (messageId) {
    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: msgText,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  } else {
    await callApi('sendMessage', {
      chat_id: chatId,
      text: msgText,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  }
}

// 3. MIJOZLAR (CRM)
async function handleAdminClients(chatId, messageId = null) {
  if (!isAdmin(chatId)) return;

  const supabase = getSupabaseBackendClient();
  let bookings = [];

  if (supabase) {
    try {
      const { data } = await supabase.from('bookings').select('*').order('created_at', { ascending: false });
      if (data) bookings = data;
    } catch (e) {}
  }

  if (bookings.length === 0) {
    bookings = loadLocalBookings();
  }

  // Group by client
  const clientMap = new Map();
  bookings.forEach(b => {
    const key = b.chat_id || b.client_name || 'Nomaʼlum';
    if (!clientMap.has(key)) {
      clientMap.set(key, {
        name: b.client_name || 'Mijoz',
        chatId: b.chat_id,
        username: b.username,
        phone: b.client_phone,
        totalBookings: 0,
        completedBookings: 0,
        lastDate: b.date_formatted || b.date
      });
    }
    const c = clientMap.get(key);
    c.totalBookings++;
    if (b.status === 'completed') c.completedBookings++;
  });

  const uniqueClients = Array.from(clientMap.values());
  const totalCount = uniqueClients.length;
  const regularClients = uniqueClients.filter(c => c.totalBookings >= 2).length;

  let msgText = 
`👥 *DONIYOR BARBER — MIJOZLAR BAZASI (CRM)*

📊 *Umumiy statistika:*
• Jami unikal mijozlar: *${totalCount} nafar*
• Doimiy mijozlar (2+ tashrif): *${regularClients} nafar*

⭐ *So‘nggi mijozlar:*
`;

  uniqueClients.slice(0, 7).forEach((c, idx) => {
    const userTag = c.username ? ` (@${c.username.replace('@','')})` : '';
    const phoneStr = c.phone ? ` • 📞 ${c.phone}` : '';
    const badge = c.totalBookings >= 2 ? '👑 Doimiy' : '🟢 Yangi';
    msgText += `${idx + 1}. *${c.name}*${userTag}\n`;
    msgText += `   🎟 Tashriflar: ${c.totalBookings} ta | ${badge}${phoneStr}\n`;
    msgText += `   📅 Oxirgi sana: ${c.lastDate}\n\n`;
  });

  const buttons = [
    [
      { text: '🔍 Mijoz qidirish (Ism bo‘yicha)', callback_data: 'adm_crm_search' },
      { text: '📢 Barcha mijozlarga xabar', callback_data: 'adm_crm_broadcast' }
    ]
  ];

  if (messageId) {
    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: msgText,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } else {
    await callApi('sendMessage', {
      chat_id: chatId,
      text: msgText,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
}

// 4. ISH VAQTI VA GRAFIK
async function handleAdminWorkHours(chatId, messageId = null) {
  if (!isAdmin(chatId)) return;
  await syncSettings();

  const msgText = 
`⏰ *ISH VAQTI VA GRAFIK SOZLAMALARI*

💈 *Bosh usta:* ${cachedSettings.barber_name}
📍 *Manzil:* ${cachedSettings.address}
⏰ *Ish boshlanishi:* ${cachedSettings.start_time}
🌙 *Ish tugashi:* ${cachedSettings.end_time}
☕ *Tushlik tanaffusi:* 13:00 — 14:00 (Avtomatik o‘tkaziladi)
⏱ *Oraliq davomiyligi:* 30 daqiqa
📅 *Dam olish kuni:* Dam olishsiz (Har kuni ish kuni)

_O‘zgartirish uchun kerakli tugmani bosing:_`;

  const buttons = [
    [
      { text: '🕒 Boshlanish: 08:00', callback_data: 'adm_wh_start_08:00' },
      { text: '🕒 Boshlanish: 09:00', callback_data: 'adm_wh_start_09:00' },
      { text: '🕒 Boshlanish: 10:00', callback_data: 'adm_wh_start_10:00' }
    ],
    [
      { text: '🌙 Tugash: 20:00', callback_data: 'adm_wh_end_20:00' },
      { text: '🌙 Tugash: 21:00', callback_data: 'adm_wh_end_21:00' },
      { text: '🌙 Tugash: 22:00', callback_data: 'adm_wh_end_22:00' }
    ],
    [
      { text: '☕ Tushlik vaqti: 13:00 - 14:00', callback_data: 'adm_wh_lunch_info' }
    ]
  ];

  if (messageId) {
    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: msgText,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } else {
    await callApi('sendMessage', {
      chat_id: chatId,
      text: msgText,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
}

// 5. ESLATMALAR VA BROADCAST
async function handleAdminReminders(chatId, messageId = null) {
  if (!isAdmin(chatId)) return;

  const todayStr = formatDateString(getTashkentDate());
  let todayCount = 0;
  const supabase = getSupabaseBackendClient();

  if (supabase) {
    try {
      const { data } = await supabase.from('bookings').select('id').eq('date', todayStr).neq('status', 'cancelled');
      if (data) todayCount = data.length;
    } catch (e) {}
  }

  const msgText = 
`🔔 *ESLATMALAR VA XABARNOMALAR TIZIMI*

1. ⏰ *Avtomatik eslatmalar (Faol):*
   • Bron qilinganda darhol chipta yuboriladi.
   • Soch oldirishga *30 daqiqa* qolganda 1-eslatma boradi.
   • Soch oldirishga *15 daqiqa* qolganda 2-tezkor eslatma boradi.

2. 📢 *Ommaviy xabar (Broadcast):*
   • Barcha mijozlarga birdaniga aksiya, bayram tabrigi yoki yangilik yuborish.

3. 🔔 *Bugungi mijozlar eslatmasi:*
   • Bugun navbatga yozilgan *${todayCount} nafar* mijozga qo‘lda ham tezkor eslatma jo‘natish.`;

  const buttons = [
    [
      { text: '📢 Barcha mijozlarga ommaviy xabar jo‘natish', callback_data: 'adm_rem_broadcast' }
    ],
    [
      { text: `🔔 Bugungi mijozlarga eslatma jo‘natish (${todayCount})`, callback_data: 'adm_rem_today_clients' }
    ]
  ];

  if (messageId) {
    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: msgText,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } else {
    await callApi('sendMessage', {
      chat_id: chatId,
      text: msgText,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
}

// 6. KUTISH RO'YXATI (WAITLIST)
async function handleAdminWaitlist(chatId, messageId = null) {
  if (!isAdmin(chatId)) return;

  const list = loadWaitlist();

  let msgText = 
`⏳ *KUTISH RO‘YXATI (WAITLIST)*

Barcha vaqtlar band bo‘lgan kunlarda navbat kutayotgan mijozlar ro‘yxati.
Agar biror mijoz o‘z navbatini bekor qilsa, kutishdagi mijozlarga darhol xabar berish mumkin.

👥 *Hozirgi kutishdagilar:* ${list.length} nafar\n\n`;

  if (list.length === 0) {
    msgText += '_Hozircha kutish ro‘yxatida mijozlar yo‘q._';
  } else {
    list.forEach((item, idx) => {
      msgText += `${idx + 1}. 👤 *${item.name}* (📞 ${item.phone || 'Tel yo‘q'})\n`;
      msgText += `   📅 So‘ragan sana: ${item.date} • ${item.time || 'Ixtiyoriy vaqt'}\n\n`;
    });
  }

  const buttons = [
    [
      { text: '➕ Kutishga yangi mijoz qo‘shish', callback_data: 'adm_wl_add' }
    ]
  ];

  if (list.length > 0) {
    buttons.push([
      { text: '📢 Bo‘sh joy haqida hammaga xabar berish', callback_data: 'adm_wl_notify_all' },
      { text: '🗑 Ro‘yxatni tozalash', callback_data: 'adm_wl_clear' }
    ]);
  }

  if (messageId) {
    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: msgText,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } else {
    await callApi('sendMessage', {
      chat_id: chatId,
      text: msgText,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
}

// 7. STATISTIKA
async function handleAdminStats(chatId, messageId = null) {
  if (!isAdmin(chatId)) return;

  const todayStr = formatDateString(getTashkentDate());
  let allBookings = [];
  const supabase = getSupabaseBackendClient();

  if (supabase) {
    try {
      const { data } = await supabase.from('bookings').select('*');
      if (data) allBookings = data;
    } catch (e) {}
  }
  if (allBookings.length === 0) {
    allBookings = loadLocalBookings();
  }

  const todayBookings = allBookings.filter(b => b.date === todayStr);
  const todayConfirmed = todayBookings.filter(b => b.status === 'confirmed').length;
  const todayCompleted = todayBookings.filter(b => b.status === 'completed').length;
  const todayCancelled = todayBookings.filter(b => b.status === 'cancelled').length;

  const totalAll = allBookings.length;
  const totalCompleted = allBookings.filter(b => b.status === 'completed').length;
  const totalCancelled = allBookings.filter(b => b.status === 'cancelled').length;
  const totalActive = allBookings.filter(b => b.status === 'confirmed').length;

  // Revenue estimation
  const price = cachedSettings.price || 80000;
  const todayRevenue = (todayConfirmed + todayCompleted) * price;
  const totalRevenue = (totalCompleted + totalActive) * price;

  // Unique clients
  const uniqueClients = new Set(allBookings.map(b => b.chat_id || b.client_name)).size;

  const msgText = 
`📊 *DONIYOR BARBER — STATISTIKA HISOBOTI*

📅 *Bugungi ko‘rsatkichlar (${todayStr}):*
• 🎯 Jami bronlar: *${todayBookings.length} ta*
• 🟢 Tasdiqlangan (Faol): *${todayConfirmed} ta*
• ✅ Yakunlangan: *${todayCompleted} ta*
• ❌ Bekor qilingan: *${todayCancelled} ta*
• 💰 Taxminiy tushum: *${todayRevenue.toLocaleString('uz-UZ')} so‘m*

📈 *Umumiy statistika:*
• 👥 Jami mijozlar: *${uniqueClients} nafar*
• 🎟 Barcha vaqtdagi bronlar: *${totalAll} ta*
• ✅ Muvaffaqiyatli xizmatlar: *${totalCompleted} ta*
• 🟢 Hozir kutilayotgan faollar: *${totalActive} ta*
• ❌ Jami bekor qilinganlar: *${totalCancelled} ta*
• 💵 Umumiy tushum: *${totalRevenue.toLocaleString('uz-UZ')} so‘m*

⭐ *Eng ommabop vaqtlar:* 16:00, 16:30, 17:00, 18:00
☁️ *Baza:* Supabase Cloud PostgreSQL (Jonli)`;

  const buttons = [
    [
      { text: '🔄 Yangilash', callback_data: 'adm_stats_refresh' }
    ]
  ];

  if (messageId) {
    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: msgText,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } else {
    await callApi('sendMessage', {
      chat_id: chatId,
      text: msgText,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
}

// 8. SOZLAMALAR
async function handleAdminSettings(chatId, messageId = null) {
  if (!isAdmin(chatId)) return;
  await syncSettings();

  const msgText = 
`⚙️ *TIZIM SOZLAMALARI*

💈 *Barberxona nomi:* ${cachedSettings.shop_name}
👤 *Bosh usta:* ${cachedSettings.barber_name}
📍 *Manzil:* ${cachedSettings.address}
📞 *Telefon:* ${cachedSettings.phone}
💰 *Standart narx:* ${(cachedSettings.price || 80000).toLocaleString('uz-UZ')} so‘m
⏰ *Ish tartibi:* ${cachedSettings.start_time} - ${cachedSettings.end_time}

👑 *Adminlar:* \`835865320\`, \`5236823441\`
☁️ *Ma’lumotlar bazasi:* Supabase PostgreSQL (Ulangan 🟢)

_O‘zgartirmoqchi bo‘lgan parametrni tanlang:_`;

  const buttons = [
    [
      { text: '📍 Manzilni tahrirlash', callback_data: 'adm_set_edit_address' },
      { text: '📞 Telefonni tahrirlash', callback_data: 'adm_set_edit_phone' }
    ],
    [
      { text: '💰 Narxni o‘zgartirish', callback_data: 'adm_set_edit_price' },
      { text: '🔄 Bazani sinash', callback_data: 'adm_set_test_db' }
    ]
  ];

  if (messageId) {
    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: msgText,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } else {
    await callApi('sendMessage', {
      chat_id: chatId,
      text: msgText,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
}

// ====================================================================
// MESSAGE ROUTER (Asosiy xabarlar boshqaruvi)
// ====================================================================
async function handleMessage(msg) {
  const chatId = msg.chat?.id;
  if (!chatId) return;

  const text = msg.text ? msg.text.trim() : '';
  const lower = text.toLowerCase();

  console.log(`[Xabar keldi] chatId: ${chatId}, matn: "${text}"`);

  // ADMIN MULTI-STEP SESSION INTERACTION
  if (isAdmin(chatId) && adminSessions.has(chatId)) {
    const aSession = adminSessions.get(chatId);

    // 1. Manzilni tahrirlash
    if (aSession.step === 'edit_address') {
      cachedSettings.address = text;
      const sb = getSupabaseBackendClient();
      if (sb) {
        await sb.from('settings').update({ address: text, updated_at: new Date().toISOString() }).eq('id', 'default');
      }
      adminSessions.delete(chatId);
      await callApi('sendMessage', {
        chat_id: chatId,
        text: `✅ *Manzil muvaffaqiyatli saqlandi:*\n📍 ${text}`,
        parse_mode: 'Markdown'
      });
      return handleAdminSettings(chatId);
    }

    // 2. Telefonni tahrirlash
    if (aSession.step === 'edit_phone') {
      cachedSettings.phone = text;
      const sb = getSupabaseBackendClient();
      if (sb) {
        await sb.from('settings').update({ phone: text, updated_at: new Date().toISOString() }).eq('id', 'default');
      }
      adminSessions.delete(chatId);
      await callApi('sendMessage', {
        chat_id: chatId,
        text: `✅ *Telefon raqami muvaffaqiyatli saqlandi:*\n📞 ${text}`,
        parse_mode: 'Markdown'
      });
      return handleAdminSettings(chatId);
    }

    // 3. Narxni tahrirlash
    if (aSession.step === 'edit_price') {
      const num = parseInt(text.replace(/\D/g, ''), 10);
      if (num && num >= 10000) {
        cachedSettings.price = num;
        const sb = getSupabaseBackendClient();
        if (sb) {
          await sb.from('services').update({ price: num }).eq('id', 'srv-1');
        }
        adminSessions.delete(chatId);
        await callApi('sendMessage', {
          chat_id: chatId,
          text: `✅ *Yangi narx saqlandi:* ${num.toLocaleString('uz-UZ')} so‘m`,
          parse_mode: 'Markdown'
        });
        return handleAdminSettings(chatId);
      } else {
        return callApi('sendMessage', {
          chat_id: chatId,
          text: 'Iltimos, to‘g‘ri summa kiriting (masalan: 80000):'
        });
      }
    }

    // 4. Ommaviy xabar (Broadcast)
    if (aSession.step === 'broadcast_text') {
      aSession.broadcastMessage = text;
      aSession.step = 'broadcast_confirm';
      adminSessions.set(chatId, aSession);

      return callApi('sendMessage', {
        chat_id: chatId,
        text: `📢 *Quyidagi xabarni barcha mijozlarga yuborishni tasdiqlaysizmi?*\n\n"${text}"`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Ha, yuborilsin', callback_data: 'adm_confirm_broadcast' },
              { text: '❌ Bekor qilish', callback_data: 'adm_cancel_broadcast' }
            ]
          ]
        }
      });
    }

    // 5. Admin walk-in mijoz ismi va telefoni
    if (aSession.step === 'walkin_client_info') {
      const clientName = text;
      const selectedDate = aSession.selectedDate;
      const selectedTime = aSession.selectedTime;
      const bookingCode = generateBookingCode();

      const newBooking = {
        id: 'bk-' + Date.now(),
        booking_code: bookingCode,
        client_name: clientName,
        client_phone: '',
        date: selectedDate,
        date_formatted: aSession.selectedDateTitle,
        time_slot: selectedTime,
        duration: 30,
        service_id: 'standard',
        service_name: 'Barberxona xizmati',
        price: cachedSettings.price || 80000,
        status: 'confirmed',
        source: 'admin',
        chat_id: null,
        username: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const sb = getSupabaseBackendClient();
      if (sb) {
        await sb.from('bookings').insert([newBooking]);
      }
      const all = loadLocalBookings();
      all.push(newBooking);
      saveLocalBookings(all);

      adminSessions.delete(chatId);

      await callApi('sendMessage', {
        chat_id: chatId,
        text: `✅ *Yangi bron qo‘shildi!*\n\n🎟 Kod: \`${bookingCode}\`\n👤 Mijoz: ${clientName}\n📅 Sana: ${selectedDate}\n⏰ Vaqt: ${selectedTime}`,
        parse_mode: 'Markdown',
        reply_markup: ADMIN_PANEL_KEYBOARD
      });
      return handleAdminBookings(chatId, 'today');
    }

    // 6. Kutish ro'yxatiga mijoz qo'shish
    if (aSession.step === 'waitlist_add') {
      const waitlist = loadWaitlist();
      waitlist.push({
        id: 'wl-' + Date.now(),
        name: text,
        date: formatDateString(getTashkentDate()),
        time: 'Ixtiyoriy',
        createdAt: new Date().toISOString()
      });
      saveWaitlist(waitlist);
      adminSessions.delete(chatId);

      await callApi('sendMessage', {
        chat_id: chatId,
        text: `✅ *Mijoz kutish ro‘yxatiga qo‘shildi:* ${text}`,
        parse_mode: 'Markdown'
      });
      return handleAdminWaitlist(chatId);
    }
  }

  // START / MENU
  if (lower === '/start' || lower === '/menu' || lower === 'start' || lower === 'menyu') {
    return handleStart(chatId, msg.from?.first_name);
  }

  // ADMIN PANEL BUYRUQLARI
  if (lower === '👑 admin panel' || lower === '/admin' || lower === 'admin') {
    if (isAdmin(chatId)) {
      return handleAdminPanelHome(chatId);
    } else {
      return callApi('sendMessage', {
        chat_id: chatId,
        text: '⛔ Kechirasiz, sizda Admin huquqi yo‘q.',
        reply_markup: CLIENT_MAIN_KEYBOARD
      });
    }
  }

  // ADMIN BO'LIMLARI (Admin klaviaturasi bosilganda)
  if (isAdmin(chatId)) {
    if (lower.includes('bronlar')) {
      return handleAdminBookings(chatId, 'today');
    }
    if (lower.includes('kalendar')) {
      return handleAdminCalendar(chatId);
    }
    if (lower.includes('mijozlar')) {
      return handleAdminClients(chatId);
    }
    if (lower.includes('ish vaqti')) {
      return handleAdminWorkHours(chatId);
    }
    if (lower.includes('eslatmalar') && !lower.includes('navbat')) {
      return handleAdminReminders(chatId);
    }
    if (lower.includes('kutish')) {
      return handleAdminWaitlist(chatId);
    }
    if (lower.includes('statistika')) {
      return handleAdminStats(chatId);
    }
    if (lower.includes('sozlamalar')) {
      return handleAdminSettings(chatId);
    }
    if (lower.includes('mijoz rejimiga qaytish') || lower.includes('mijoz menyusiga')) {
      adminSessions.delete(chatId);
      return callApi('sendMessage', {
        chat_id: chatId,
        text: '🔄 *Mijoz rejimiga o‘tildi.*',
        parse_mode: 'Markdown',
        reply_markup: getMainKeyboard(chatId)
      });
    }
  }

  // 1. MIJOZ: NAVBAT OLISH (Haftalik kalendar)
  if (lower.includes('navbat') || lower === '/navbat' || lower === '/book') {
    const days = getUpcomingDays(7);
    const inlineButtons = [];

    let row = [];
    days.forEach((day, index) => {
      row.push({
        text: day.label,
        callback_data: `date_${day.dateStr}`
      });
      if (row.length === 2 || index === days.length - 1) {
        inlineButtons.push(row);
        row = [];
      }
    });

    userSessions.set(chatId, {
      step: 'date',
      clientName: `${msg.from?.first_name || ''} ${msg.from?.last_name || ''}`.trim() || 'Mijoz',
      username: msg.from?.username ? `@${msg.from.username}` : ''
    });

    await callApi('sendMessage', {
      chat_id: chatId,
      text: `📅 *Sana tanlang:*\n\nO‘zingizga qulay sanani tanlang:`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: inlineButtons
      }
    });
    return;
  }

  // 2. MIJOZ: MENING BRONLARIM
  if (lower.includes('bron') || lower === '/mybookings') {
    let myBookings = [];
    const supabase = getSupabaseBackendClient();

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('bookings')
          .select('*')
          .eq('chat_id', chatId)
          .neq('status', 'cancelled')
          .order('date', { ascending: true });

        if (!error && Array.isArray(data)) {
          myBookings = data.map(b => ({
            id: b.id,
            bookingCode: b.booking_code,
            dateFormatted: b.date_formatted || b.date,
            timeSlot: b.time_slot,
            status: b.status
          }));
        }
      } catch (e) {
        console.error('Supabase query error:', e.message);
      }
    }

    if (myBookings.length === 0) {
      const allLocal = loadLocalBookings();
      myBookings = allLocal.filter(b => b.chatId === chatId && b.status !== 'cancelled');
    }

    if (myBookings.length === 0) {
      await callApi('sendMessage', {
        chat_id: chatId,
        text: `📋 *Sizda hozircha faol navbatlar yo‘q.*\n\nYangi navbat olish uchun *\"📅 Navbat olish\"* tugmasini bosing.`,
        parse_mode: 'Markdown',
        reply_markup: getMainKeyboard(chatId)
      });
      return;
    }

    let responseText = `📋 *Sizning faol bronlaringiz (${myBookings.length}):*\n\n`;
    const buttons = [];

    myBookings.forEach((b, idx) => {
      responseText += `${idx + 1}. 🎟 *Kodi:* \`${b.bookingCode}\`\n`;
      responseText += `   📅 *Sana:* ${b.dateFormatted}\n`;
      responseText += `   ⏰ *Vaqt:* ${b.timeSlot}\n`;
      responseText += `   📍 *Manzil:* ${cachedSettings.address}\n`;
      responseText += `   🟢 *Holat:* ${b.status === 'confirmed' ? 'Tasdiqlangan ✓' : 'Kutilmoqda'}\n\n`;

      buttons.push([{
        text: `❌ Bekor qilish: ${b.bookingCode}`,
        callback_data: `cancel_${b.id}`
      }]);
    });

    await callApi('sendMessage', {
      chat_id: chatId,
      text: responseText,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons
      }
    });
    return;
  }

  // 3. MIJOZ: ESLATMALAR
  if (lower.includes('eslatma') || lower === '/reminders') {
    await callApi('sendMessage', {
      chat_id: chatId,
      text: 
`🔔 *Avtomatik eslatmalar tizimi*

Siz navbat olganingizda tizim sizni ogohlantirib turadi:
1. 🎟 Bron tasdiqlanganda darhol chipta olasiz.
2. ⏰ Navbatingizga *30 daqiqa* qolganda birinchi eslatma yuboriladi.
3. ⚡ Navbatingizga *15 daqiqa* qolganda ikkinchi tezkor eslatma yuboriladi.

Barberxonaga o‘z vaqtida kelishingizni iltimos qilamiz! 💈`,
      parse_mode: 'Markdown',
      reply_markup: getMainKeyboard(chatId)
    });
    return;
  }

  // 4. MIJOZ: MA'LUMOT
  if (lower.includes('ma’lumot') || lower.includes("ma'lumot") || lower.includes('malumot') || lower.includes('info') || lower === '/info') {
    await callApi('sendMessage', {
      chat_id: chatId,
      text: 
`💈 *${cachedSettings.shop_name}*

📍 *Manzil:* ${cachedSettings.address}
⏰ *Ish tartibi:* Har kuni ${cachedSettings.start_time} - ${cachedSettings.end_time}
✂️ *Bosh usta:* ${cachedSettings.barber_name}
📞 *Telefon:* ${cachedSettings.phone}

_Navbat olish yoki broningizni ko‘rish uchun menyudan foydalaning._`,
      parse_mode: 'Markdown',
      reply_markup: getMainKeyboard(chatId)
    });
    return;
  }

  // Noma'lum har qanday xabarda asosiy menyuni yuborish
  return handleStart(chatId, msg.from?.first_name);
}

// ====================================================================
// CALLBACK QUERY ROUTER (Tugmalar bosilganda)
// ====================================================================
async function handleCallbackQuery(query) {
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const data = query.data;

  await callApi('answerCallbackQuery', { callback_query_id: query.id });

  // -------------------------------------------------------------
  // ADMIN CALLBACKS
  // -------------------------------------------------------------
  if (isAdmin(chatId) && data.startsWith('adm_')) {
    // 1. Bronlar filtri
    if (data.startsWith('adm_book_filter_')) {
      const filter = data.replace('adm_book_filter_', '');
      return handleAdminBookings(chatId, filter, messageId);
    }

    // 2. Bronni yakunlash
    if (data.startsWith('adm_action_complete_')) {
      const bId = data.replace('adm_action_complete_', '');
      const sb = getSupabaseBackendClient();
      if (sb) {
        await sb.from('bookings').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', bId);
      }
      const all = loadLocalBookings();
      const target = all.find(b => b.id === bId);
      if (target) target.status = 'completed';
      saveLocalBookings(all);

      await callApi('answerCallbackQuery', { callback_query_id: query.id, text: '✅ Bron yakunlandi!' });
      return handleAdminBookings(chatId, 'today', messageId);
    }

    // 3. Bronni bekor qilish (Admin tomonidan)
    if (data.startsWith('adm_action_cancel_')) {
      const bId = data.replace('adm_action_cancel_', '');
      const sb = getSupabaseBackendClient();
      let clientChatId = null;
      let dateTitle = '';
      let time = '';

      if (sb) {
        const { data: bData } = await sb.from('bookings').select('chat_id, date_formatted, time_slot').eq('id', bId).single();
        if (bData) {
          clientChatId = bData.chat_id;
          dateTitle = bData.date_formatted;
          time = bData.time_slot;
        }
        await sb.from('bookings').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', bId);
      }

      // Mijozga ogohlantirish xabari jo'natish
      if (clientChatId) {
        callApi('sendMessage', {
          chat_id: clientChatId,
          text: `⚠️ *Doniyor Barber ogohlantirishi:*\nSizning ${dateTitle} soat ${time} dagi navbatingiz bekor qilindi. Boshqa vaqt olish uchun qaytadan botdan foydalanishingiz mumkin.`,
          parse_mode: 'Markdown'
        }).catch(() => {});
      }

      await callApi('answerCallbackQuery', { callback_query_id: query.id, text: '❌ Bron bekor qilindi!' });
      return handleAdminBookings(chatId, 'today', messageId);
    }

    // 4. Admin yangi mijoz qo'shish (Walk-in)
    if (data === 'adm_add_walkin') {
      const days = getUpcomingDays(7);
      const buttons = [];
      let row = [];
      days.forEach((day, idx) => {
        row.push({ text: day.label, callback_data: `adm_walkin_date_${day.dateStr}` });
        if (row.length === 2 || idx === days.length - 1) {
          buttons.push(row);
          row = [];
        }
      });
      return callApi('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: '➕ *Yangi bron qo‘shish:*\nQaysi kunga navbat qo‘shmoqchisiz?',
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
    }

    if (data.startsWith('adm_walkin_date_')) {
      const dateStr = data.replace('adm_walkin_date_', '');
      const days = getUpcomingDays(7);
      const dayObj = days.find(d => d.dateStr === dateStr) || days[0];

      adminSessions.set(chatId, {
        step: 'walkin_slot',
        selectedDate: dateStr,
        selectedDateTitle: dayObj.fullTitle
      });

      const buttons = [];
      let row = [];
      TIME_SLOTS.forEach((slot, idx) => {
        row.push({ text: `🟢 ${slot}`, callback_data: `adm_walkin_time_${slot}` });
        if (row.length === 3 || idx === TIME_SLOTS.length - 1) {
          buttons.push(row);
          row = [];
        }
      });

      return callApi('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `📅 *Sana:* ${dayObj.fullTitle}\n\nVaqtni tanlang:`,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
    }

    if (data.startsWith('adm_walkin_time_')) {
      const timeSlot = data.replace('adm_walkin_time_', '');
      const aSession = adminSessions.get(chatId) || {};
      aSession.selectedTime = timeSlot;
      aSession.step = 'walkin_client_info';
      adminSessions.set(chatId, aSession);

      return callApi('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `📅 *Sana:* ${aSession.selectedDateTitle}\n⏰ *Vaqt:* ${timeSlot}\n\n✍️ *Mijoz ismi va telefonini yozib yuboring:*\n_(Masalan: Ali +998901234567)_`,
        parse_mode: 'Markdown'
      });
    }

    // 5. Kalendar kungi vaqtlar ustiga bosilganda
    if (data.startsWith('adm_cal_date_')) {
      const dateStr = data.replace('adm_cal_date_', '');
      return handleAdminCalendar(chatId, dateStr, messageId);
    }

    if (data.startsWith('adm_slot_click_')) {
      const parts = data.split('_'); // ['adm', 'slot', 'click', '2026-11-07', '14:00', 'free'/'blocked'/'booked']
      const sDate = parts[3];
      const sTime = parts[4];
      const sType = parts[5];

      if (sType === 'free') {
        return callApi('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: `⏰ *${sTime}* (${sDate}) — Bo‘sh vaqt.\n\nNima qilmoqchisiz?`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🚫 Ushbu vaqtni BLOKLASH', callback_data: `adm_do_block_${sDate}_${sTime}` }],
              [{ text: '◀ Kalendarga qaytish', callback_data: `adm_cal_date_${sDate}` }]
            ]
          }
        });
      }

      if (sType === 'blocked') {
        return callApi('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: `🚫 *${sTime}* (${sDate}) — Ushbu vaqt bloklangan.\n\nVaqtni mijozlar uchun ochmoqchimisiz?`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🟢 Blokdan chiqarish (OCHISH)', callback_data: `adm_do_unblock_${sDate}_${sTime}` }],
              [{ text: '◀ Kalendarga qaytish', callback_data: `adm_cal_date_${sDate}` }]
            ]
          }
        });
      }

      if (sType === 'booked') {
        const sb = getSupabaseBackendClient();
        let clientInfo = 'Band qilingan';
        let bId = null;
        if (sb) {
          const { data: bData } = await sb.from('bookings').select('*').eq('date', sDate).eq('time_slot', sTime).neq('status', 'cancelled').single();
          if (bData) {
            clientInfo = `👤 *${bData.client_name}*\n🎟 Kod: \`${bData.booking_code}\`\n📞 Tel: ${bData.client_phone || 'Yo‘q'}`;
            bId = bData.id;
          }
        }
        return callApi('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: `🔴 *${sTime}* (${sDate}) band qilingan:\n\n${clientInfo}`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              bId ? [{ text: '❌ Ushbu bronni bekor qilish', callback_data: `adm_action_cancel_${bId}` }] : [],
              [{ text: '◀ Kalendarga qaytish', callback_data: `adm_cal_date_${sDate}` }]
            ]
          }
        });
      }
    }

    // Bloklash amali
    if (data.startsWith('adm_do_block_')) {
      const parts = data.split('_');
      const bDate = parts[3];
      const bTime = parts[4];
      const sb = getSupabaseBackendClient();
      if (sb) {
        await sb.from('blocked_slots').insert([{
          id: 'blk-' + Date.now(),
          date: bDate,
          time: bTime,
          duration: 30,
          reason: 'Admin tomonidan bloklangan'
        }]);
      }
      await callApi('answerCallbackQuery', { callback_query_id: query.id, text: `🚫 ${bTime} bloklandi!` });
      return handleAdminCalendar(chatId, bDate, messageId);
    }

    // Blokdan chiqarish amali
    if (data.startsWith('adm_do_unblock_')) {
      const parts = data.split('_');
      const bDate = parts[3];
      const bTime = parts[4];
      const sb = getSupabaseBackendClient();
      if (sb) {
        await sb.from('blocked_slots').delete().eq('date', bDate).eq('time', bTime);
      }
      await callApi('answerCallbackQuery', { callback_query_id: query.id, text: `🟢 ${bTime} ochildi!` });
      return handleAdminCalendar(chatId, bDate, messageId);
    }

    // 6. Ish vaqtini o'zgartirish
    if (data.startsWith('adm_wh_start_')) {
      const newStart = data.replace('adm_wh_start_', '');
      cachedSettings.start_time = newStart;
      const sb = getSupabaseBackendClient();
      if (sb) await sb.from('settings').update({ start_time: newStart }).eq('id', 'default');
      await callApi('answerCallbackQuery', { callback_query_id: query.id, text: `Ish boshlanishi: ${newStart}` });
      return handleAdminWorkHours(chatId, messageId);
    }

    if (data.startsWith('adm_wh_end_')) {
      const newEnd = data.replace('adm_wh_end_', '');
      cachedSettings.end_time = newEnd;
      const sb = getSupabaseBackendClient();
      if (sb) await sb.from('settings').update({ end_time: newEnd }).eq('id', 'default');
      await callApi('answerCallbackQuery', { callback_query_id: query.id, text: `Ish tugashi: ${newEnd}` });
      return handleAdminWorkHours(chatId, messageId);
    }

    // 7. Eslatmalar va Broadcast
    if (data === 'adm_rem_broadcast' || data === 'adm_crm_broadcast') {
      adminSessions.set(chatId, { step: 'broadcast_text' });
      return callApi('sendMessage', {
        chat_id: chatId,
        text: '✍️ *Barcha mijozlarga yubormoqchi bo‘lgan xabaringizni yozib yuboring:*\n_(Aksiya, tabrik yoki eʼlon matnini yuboring)_',
        parse_mode: 'Markdown'
      });
    }

    if (data === 'adm_confirm_broadcast') {
      const aSession = adminSessions.get(chatId);
      const textToSend = aSession?.broadcastMessage;
      adminSessions.delete(chatId);

      if (!textToSend) {
        return callApi('sendMessage', { chat_id: chatId, text: 'Xabar topilmadi.' });
      }

      // Supabase dan barcha unikal chat_id larni olish
      const sb = getSupabaseBackendClient();
      let chatIds = [];
      if (sb) {
        const { data: bData } = await sb.from('bookings').select('chat_id');
        if (bData) {
          chatIds = Array.from(new Set(bData.map(b => b.chat_id).filter(Boolean)));
        }
      }

      let sentCount = 0;
      for (const cId of chatIds) {
        try {
          await callApi('sendMessage', {
            chat_id: cId,
            text: `📢 *DONIYOR BARBER XABARNOMASI:*\n\n${textToSend}`,
            parse_mode: 'Markdown'
          });
          sentCount++;
        } catch (e) {}
      }

      return callApi('sendMessage', {
        chat_id: chatId,
        text: `✅ *Xabar ${sentCount} nafar mijozga muvaffaqiyatli yetkazildi!*`,
        parse_mode: 'Markdown'
      });
    }

    if (data === 'adm_cancel_broadcast') {
      adminSessions.delete(chatId);
      return callApi('sendMessage', { chat_id: chatId, text: '❌ Xabar yuborish bekor qilindi.' });
    }

    // Bugungi navbatdagilarga eslatma jo'natish
    if (data === 'adm_rem_today_clients') {
      const todayStr = formatDateString(getTashkentDate());
      const sb = getSupabaseBackendClient();
      let todayList = [];
      if (sb) {
        const { data: tData } = await sb.from('bookings').select('*').eq('date', todayStr).neq('status', 'cancelled');
        if (tData) todayList = tData;
      }

      let count = 0;
      for (const b of todayList) {
        if (b.chat_id) {
          try {
            await callApi('sendMessage', {
              chat_id: b.chat_id,
              text: `🔔 *Doniyor Barber eslatmasi:*\nHurmatli *${b.client_name}*, bugun soat *${b.time_slot}* da sizning navbatingiz bor.\nManzil: ${cachedSettings.address}.\n\nO‘z vaqtida kelishingizni kutib qolamiz! 💈`,
              parse_mode: 'Markdown'
            });
            count++;
          } catch (e) {}
        }
      }

      return callApi('sendMessage', {
        chat_id: chatId,
        text: `✅ Bugun navbati bor *${count} nafar* mijozga eslatma yuborildi!`,
        parse_mode: 'Markdown'
      });
    }

    // 8. Kutish ro'yxati boshqaruvi
    if (data === 'adm_wl_add') {
      adminSessions.set(chatId, { step: 'waitlist_add' });
      return callApi('sendMessage', {
        chat_id: chatId,
        text: '✍️ *Kutish ro‘yxatiga qo‘shiladigan mijoz ismi va telefonini yozing:*\n_(Masalan: Davron +998905554433)_',
        parse_mode: 'Markdown'
      });
    }

    if (data === 'adm_wl_clear') {
      saveWaitlist([]);
      await callApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Kutish ro‘yxati tozalandi!' });
      return handleAdminWaitlist(chatId, messageId);
    }

    // 9. Sozlamalarni tahrirlash
    if (data === 'adm_set_edit_address') {
      adminSessions.set(chatId, { step: 'edit_address' });
      return callApi('sendMessage', {
        chat_id: chatId,
        text: `📍 *Hozirgi manzil:* ${cachedSettings.address}\n\nYangi manzilni yozib yuboring:`
      });
    }

    if (data === 'adm_set_edit_phone') {
      adminSessions.set(chatId, { step: 'edit_phone' });
      return callApi('sendMessage', {
        chat_id: chatId,
        text: `📞 *Hozirgi telefon:* ${cachedSettings.phone}\n\nYangi telefon raqamini yozib yuboring:`
      });
    }

    if (data === 'adm_set_edit_price') {
      adminSessions.set(chatId, { step: 'edit_price' });
      return callApi('sendMessage', {
        chat_id: chatId,
        text: `💰 *Hozirgi xizmat narxi:* ${cachedSettings.price} so‘m\n\nYangi narxni yozing (masalan: 90000):`
      });
    }

    if (data === 'adm_set_test_db') {
      const sb = getSupabaseBackendClient();
      let status = '❌ Ulanmadi';
      if (sb) {
        const { error } = await sb.from('settings').select('id').limit(1);
        if (!error) status = '🟢 Supabase PostgreSQL mukammal ishlamoqda!';
      }
      return callApi('sendMessage', { chat_id: chatId, text: `Baza holati: ${status}` });
    }

    if (data === 'adm_stats_refresh') {
      return handleAdminStats(chatId, messageId);
    }
  }

  // -------------------------------------------------------------
  // CLIENT BOOKING CALLBACKS
  // -------------------------------------------------------------
  const session = userSessions.get(chatId) || {
    clientName: `${query.from?.first_name || ''} ${query.from?.last_name || ''}`.trim() || 'Mijoz',
    username: query.from?.username ? `@${query.from.username}` : ''
  };

  // Sana tanlandi
  if (data.startsWith('date_')) {
    const selectedDateStr = data.replace('date_', '');
    const days = getUpcomingDays(14);
    const dayObj = days.find(d => d.dateStr === selectedDateStr) || days[0];

    session.selectedDate = selectedDateStr;
    session.selectedDateTitle = dayObj.fullTitle;
    userSessions.set(chatId, session);

    // Supabase dan band va bloklangan vaqtlarni olish
    let dayBookedTimes = [];
    let dayBlockedTimes = [];
    const supabase = getSupabaseBackendClient();

    if (supabase) {
      try {
        const { data: dbBookings } = await supabase
          .from('bookings')
          .select('time_slot')
          .eq('date', selectedDateStr)
          .neq('status', 'cancelled');
        if (dbBookings) {
          dayBookedTimes = dbBookings.map(b => b.time_slot);
        }

        const { data: dbBlocked } = await supabase
          .from('blocked_slots')
          .select('time')
          .eq('date', selectedDateStr);
        if (dbBlocked) {
          dayBlockedTimes = dbBlocked.map(b => b.time);
        }
      } catch (e) {
        console.error('Supabase get slots error:', e.message);
      }
    }

    if (dayBookedTimes.length === 0) {
      const allLocal = loadLocalBookings();
      dayBookedTimes = allLocal
        .filter(b => b.date === selectedDateStr && b.status !== 'cancelled')
        .map(b => b.timeSlot);
    }

    const timeButtons = [];
    let row = [];

    TIME_SLOTS.forEach((slot, index) => {
      const isBooked = dayBookedTimes.includes(slot) || dayBlockedTimes.includes(slot);
      const btnText = isBooked ? `🔴 ${slot}` : `🟢 ${slot}`;

      row.push({
        text: btnText,
        callback_data: isBooked ? 'slot_busy' : `time_${slot}`
      });

      if (row.length === 3 || index === TIME_SLOTS.length - 1) {
        timeButtons.push(row);
        row = [];
      }
    });

    timeButtons.push([
      { text: '◀ Boshqa sana tanlash', callback_data: 'back_to_dates' }
    ]);

    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `📅 *Tanlangan sana:* ${dayObj.fullTitle}\n\n⏰ *Vaqt tanlang:*\n🟢 _Bo‘sh vaqt_ | 🔴 _Band vaqt_`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: timeButtons
      }
    });
    return;
  }

  // Band vaqt bosilganda
  if (data === 'slot_busy') {
    await callApi('sendMessage', {
      chat_id: chatId,
      text: `⚠️ Ushbu vaqt allaqachon band qilingan. Iltimos, boshqa bo‘sh (🟢) vaqtni tanlang.`
    });
    return;
  }

  // Sanaga qaytish
  if (data === 'back_to_dates') {
    const days = getUpcomingDays(7);
    const inlineButtons = [];
    let row = [];
    days.forEach((day, index) => {
      row.push({
        text: day.label,
        callback_data: `date_${day.dateStr}`
      });
      if (row.length === 2 || index === days.length - 1) {
        inlineButtons.push(row);
        row = [];
      }
    });

    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `📅 *Sana tanlang:*\n\nO‘zingizga qulay sanani tanlang:`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: inlineButtons
      }
    });
    return;
  }

  // Vaqt tanlandi -> Tasdiqlash ekrani
  if (data.startsWith('time_')) {
    const selectedSlot = data.replace('time_', '');
    session.selectedTime = selectedSlot;
    userSessions.set(chatId, session);

    const confirmText = 
`📑 *Bron ma’lumotlari:*

👤 *Mijoz:* ${session.clientName}
📅 *Sana:* ${session.selectedDateTitle}
⏰ *Vaqt:* ${session.selectedTime}
📍 *Manzil:* ${cachedSettings.address}

*Bronni tasdiqlaysizmi?*`;

    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: confirmText,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Tasdiqlash', callback_data: 'confirm_booking' },
            { text: '❌ Bekor qilish', callback_data: 'cancel_flow' }
          ],
          [
            { text: '◀ Vaqtni o‘zgartirish', callback_data: `date_${session.selectedDate}` }
          ]
        ]
      }
    });
    return;
  }

  // Bron tasdiqlandi
  if (data === 'confirm_booking') {
    if (!session.selectedDate || !session.selectedTime) {
      await callApi('sendMessage', {
        chat_id: chatId,
        text: 'Xatolik yuz berdi. Iltimos, qaytadan urinib ko‘ring.',
        reply_markup: getMainKeyboard(chatId)
      });
      return;
    }

    const supabase = getSupabaseBackendClient();

    // Supabase da to'qnashuvni tekshirish
    if (supabase) {
      try {
        const { data: collisions } = await supabase
          .from('bookings')
          .select('id')
          .eq('date', session.selectedDate)
          .eq('time_slot', session.selectedTime)
          .neq('status', 'cancelled');

        if (collisions && collisions.length > 0) {
          await callApi('sendMessage', {
            chat_id: chatId,
            text: `⚠️ Kechirasiz! ${session.selectedTime} vaqti hozirgina boshqa mijoz tomonidan band qilindi. Iltimos, boshqa bo‘sh vaqt tanlang.`,
            reply_markup: getMainKeyboard(chatId)
          });
          return;
        }
      } catch (e) {
        console.error('Supabase collision check error:', e.message);
      }
    }

    const bookingCode = generateBookingCode();
    const newBooking = {
      id: 'bk-' + Date.now(),
      chatId,
      bookingCode,
      clientName: session.clientName,
      username: session.username || '',
      date: session.selectedDate,
      dateFormatted: session.selectedDateTitle,
      timeSlot: session.selectedTime,
      duration: 30,
      serviceName: 'Barberxona xizmati',
      source: 'telegram',
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };

    // Supabase ga saqlash
    if (supabase) {
      try {
        const { error } = await supabase.from('bookings').insert([{
          id: newBooking.id,
          booking_code: newBooking.bookingCode,
          client_name: newBooking.clientName,
          client_phone: '',
          date: newBooking.date,
          date_formatted: newBooking.dateFormatted,
          time_slot: newBooking.timeSlot,
          duration: 30,
          service_id: 'standard',
          service_name: newBooking.serviceName,
          price: cachedSettings.price || 80000,
          status: 'confirmed',
          source: 'telegram',
          chat_id: chatId,
          username: newBooking.username,
          created_at: newBooking.createdAt,
          updated_at: newBooking.createdAt
        }]);

        if (error && (error.code === '23505' || (error.message && error.message.includes('unique')))) {
          await callApi('sendMessage', {
            chat_id: chatId,
            text: `⚠️ Kechirasiz! Bu vaqt hozirgina boshqa mijoz tomonidan band qilindi.`,
            reply_markup: getMainKeyboard(chatId)
          });
          return;
        }
      } catch (err) {
        console.warn('[Bot] Supabase save error:', err.message);
      }
    }

    // Mahalliy zaxiraga ham saqlash
    const allLocal = loadLocalBookings();
    allLocal.push(newBooking);
    saveLocalBookings(allLocal);

    const successMessage = 
`✅ *Bron muvaffaqiyatli!*
Sizning navbatingiz qabul qilindi.

🎟 *Bron kodi:* \`${bookingCode}\`
📅 *Sana:* ${session.selectedDateTitle}
⏰ *Vaqt:* ${session.selectedTime}
📍 *Manzil:* ${cachedSettings.address}

🔔 _Vaqt yaqinlashganda sizga eslatma yuboriladi._`;

    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: successMessage,
      parse_mode: 'Markdown'
    });

    await callApi('sendMessage', {
      chat_id: chatId,
      text: 'Asosiy menyu:',
      reply_markup: getMainKeyboard(chatId)
    });

    userSessions.delete(chatId);
    return;
  }

  // Bekor qilindi (Jarayonni to'xtatish)
  if (data === 'cancel_flow') {
    userSessions.delete(chatId);
    await callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: '❌ *Bron bekor qilindi.*',
      parse_mode: 'Markdown'
    });
    await callApi('sendMessage', {
      chat_id: chatId,
      text: 'Asosiy menyu:',
      reply_markup: getMainKeyboard(chatId)
    });
    return;
  }

  // Mavjud bronni bekor qilish (Mening bronlarim dan)
  if (data.startsWith('cancel_')) {
    const bookingId = data.replace('cancel_', '');

    const supabase = getSupabaseBackendClient();
    if (supabase) {
      try {
        await supabase
          .from('bookings')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('id', bookingId);
      } catch (err) {
        console.error('Supabase cancel error:', err.message);
      }
    }

    const allBookings = loadLocalBookings();
    const idx = allBookings.findIndex(b => b.id === bookingId && b.chatId === chatId);

    if (idx !== -1) {
      const removed = allBookings[idx];
      allBookings[idx].status = 'cancelled';
      saveLocalBookings(allBookings);

      await callApi('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `❌ *Bron (${removed.bookingCode}) bekor qilindi.*\n\nBo‘shagan vaqt: ${removed.dateFormatted} • ${removed.timeSlot}`,
        parse_mode: 'Markdown'
      });
    } else {
      await callApi('sendMessage', {
        chat_id: chatId,
        text: 'Bron muvaffaqiyatli bekor qilindi.'
      });
    }

    await callApi('sendMessage', {
      chat_id: chatId,
      text: 'Asosiy menyu:',
      reply_markup: getMainKeyboard(chatId)
    });
    return;
  }
}

// -------------------------------------------------------------
// Cloud Hosting uchun doimiy HTTP Server & Webhook (Port 3000)
// -------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const RENDER_PUBLIC_URL = process.env.RENDER_EXTERNAL_URL || 'https://doniyor-barber-bot.onrender.com';

const server = http.createServer(async (req, res) => {
  // 1. Telegram Webhook (POST /webhook yoki POST /)
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        if (body) {
          const update = JSON.parse(body);
          if (update.message) {
            handleMessage(update.message).catch(e => console.error('Message error:', e));
          } else if (update.callback_query) {
            handleCallbackQuery(update.callback_query).catch(e => console.error('Callback error:', e));
          }
        }
      } catch (e) {
        console.error('Webhook parse error:', e.message);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // 2. Health check (GET /)
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    status: 'active', 
    bot: '@DoniyorBarber_Bot',
    database: 'Supabase PostgreSQL',
    admins: ADMIN_IDS,
    timestamp: new Date().toISOString()
  }));
});

server.on('error', (err) => {
  console.warn('Health server notice:', err.message);
});

server.listen(PORT, () => {
  console.log(`🌐 Bot Server port ${PORT} da faol (Render/Railway 24/7 hosting uchun tayyor)`);
});

// Self-ping to keep Render free tier awake 24/7 (har 10 daqiqada o'zini ping qilib uyg'otib turadi)
setInterval(() => {
  fetch(RENDER_PUBLIC_URL)
    .then(r => console.log(`[Keep-Alive Ping] Status: ${r.status}`))
    .catch(err => console.warn('[Keep-Alive Ping Error]:', err.message));
}, 10 * 60 * 1000);

// -------------------------------------------------------------
// Telegram Long Polling Engine (Lokal rejim uchun zaxira)
// -------------------------------------------------------------
let lastUpdateId = 0;

async function pollUpdates() {
  console.log('🔄 Telegram bot xabarlarni tinglashni boshladi...');
  while (true) {
    try {
      const res = await callApi('getUpdates', {
        offset: lastUpdateId + 1,
        timeout: 25
      });

      if (res && res.ok && Array.isArray(res.result)) {
        for (const update of res.result) {
          lastUpdateId = update.update_id;

          if (update.message) {
            handleMessage(update.message).catch(e => console.error('Message error:', e));
          } else if (update.callback_query) {
            handleCallbackQuery(update.callback_query).catch(e => console.error('Callback error:', e));
          }
        }
      } else if (res && res.error_code === 409) {
        console.warn('⚠️ 409 Conflict: Bot boshqa nusxada ham ishlayapti. 5 soniyadan so‘ng qayta urinamiz.');
        await new Promise(r => setTimeout(r, 5000));
      } else {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (err) {
      console.error('Polling error:', err.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// -------------------------------------------------------------
// AVTOMATIK ESLATMALAR TIZIMI (30 minut va 15 minut oldin)
// -------------------------------------------------------------
async function checkAndSendReminders() {
  try {
    const now = getTashkentDate();
    const todayStr = formatDateString(now);

    const supabase = getSupabaseBackendClient();
    let todayBookings = [];

    if (supabase) {
      try {
        const { data } = await supabase
          .from('bookings')
          .select('*')
          .eq('date', todayStr)
          .eq('status', 'confirmed');
        if (data) todayBookings = data;
      } catch (e) {
        console.error('[Eslatma Error] Supabase fetch:', e.message);
      }
    }

    if (todayBookings.length === 0) {
      const allLocal = loadLocalBookings();
      todayBookings = allLocal.filter(b => b.date === todayStr && b.status === 'confirmed');
    }

    for (const b of todayBookings) {
      if (!b.chat_id || !b.time_slot) continue;

      const [hours, mins] = b.time_slot.split(':').map(Number);
      const target = new Date(now);
      target.setHours(hours, mins, 0, 0);

      const diffMinutes = Math.round((target.getTime() - now.getTime()) / 60000);

      // 1. 30 daqiqa qolganda eslatma (18 dan 30 minutgacha bo'lgan oraliqda)
      const key30 = `${b.id}_30m`;
      if (diffMinutes <= 30 && diffMinutes >= 18 && !sentReminders.has(key30)) {
        sentReminders.add(key30);
        saveSentReminders(sentReminders);

        const clientName = b.client_name || 'Mijoz';
        const msg = 
`🔔 *Doniyor Barber — Eslatma!*

Hurmatli *${clientName}*, navbatingizga *30 daqiqa* qoldi!

⏰ *Vaqt:* ${b.time_slot}
🎟 *Bron kodi:* \`${b.booking_code}\`
📍 *Manzil:* ${cachedSettings.address}
📞 *Telefon:* ${cachedSettings.phone}

_Barberxonaga o‘z vaqtida kelishingizni so‘raymiz!_ 💈`;

        callApi('sendMessage', {
          chat_id: b.chat_id,
          text: msg,
          parse_mode: 'Markdown'
        }).then(() => {
          console.log(`[Eslatma 30m jo‘natildi] Bron: ${b.booking_code}, Mijoz: ${clientName}, ChatId: ${b.chat_id}`);
        }).catch(err => {
          console.error('[Eslatma 30m xatosi]:', err.message);
        });
      }

      // 2. 15 daqiqa qolganda eslatma (3 dan 15 minutgacha bo'lgan oraliqda)
      const key15 = `${b.id}_15m`;
      if (diffMinutes <= 15 && diffMinutes >= 3 && !sentReminders.has(key15)) {
        sentReminders.add(key15);
        saveSentReminders(sentReminders);

        const clientName = b.client_name || 'Mijoz';
        const msg = 
`⚡ *Doniyor Barber — Tezkor eslatma!*

Hurmatli *${clientName}*, sochingizni oldirish vaqtingizga atigi *15 daqiqa* qoldi!

⏰ *Vaqt:* ${b.time_slot}
🎟 *Bron kodi:* \`${b.booking_code}\`
📍 *Manzil:* ${cachedSettings.address}

_Usta sizni kutmoqda!_ ✂️💈`;

        callApi('sendMessage', {
          chat_id: b.chat_id,
          text: msg,
          parse_mode: 'Markdown'
        }).then(() => {
          console.log(`[Eslatma 15m jo‘natildi] Bron: ${b.booking_code}, Mijoz: ${clientName}, ChatId: ${b.chat_id}`);
        }).catch(err => {
          console.error('[Eslatma 15m xatosi]:', err.message);
        });
      }
    }
  } catch (err) {
    console.error('[Eslatma tekshiruv xatosi]:', err.message);
  }
}

// Har 30 soniyada avtomatik tekshirish
setInterval(checkAndSendReminders, 30000);
// Bot ishga tushganda bir marta darhol tekshirish
setTimeout(checkAndSendReminders, 3000);

// Start
console.log('====================================================');
console.log('💈 DONIYOR BARBER TELEGRAM BOT + ADMIN PANEL ISHGA TUSHDI!');
console.log('🤖 Bot Username: @DoniyorBarber_Bot');
console.log('👑 Admin Telegram ID lari: 835865320, 5236823441');
console.log('⚡ Ma’lumotlar bazasi: Supabase (PostgreSQL)');
console.log('====================================================');

// Webhook yoki Long Polling tanlash
const IS_RENDER = Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL);

if (IS_RENDER) {
  const webhookUrl = `${RENDER_PUBLIC_URL.replace(/\/$/, '')}/webhook`;
  console.log(`🚀 Render Cloud: Webhook rejimida ishlaydi -> ${webhookUrl}`);
  callApi('setWebhook', { url: webhookUrl }).then(res => {
    console.log('Telegram Webhook muvaffaqiyatli ulandi:', res);
  }).catch(e => {
    console.error('Webhook error:', e);
  });
} else {
  console.log('🔄 Lokal rejim: Long Polling ishlaydi...');
  callApi('deleteWebhook').then(() => {
    pollUpdates();
  });
}
