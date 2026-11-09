-- ====================================================================
-- DONIYOR BARBER - SUPABASE DATABASE SCHEMA
-- Ushbu SQL kodni Supabase Dashboard -> SQL Editor bo'limiga nusxalab
-- "RUN" tugmasini bosing.
-- ====================================================================

-- 1. BRONLAR JADVALI (BOOKINGS)
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  booking_code TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_phone TEXT,
  date TEXT NOT NULL,               -- Format: YYYY-MM-DD (masalan: 2026-11-06)
  date_formatted TEXT,              -- Format: 6-noyabr, Juma
  time_slot TEXT NOT NULL,          -- Format: 14:30
  duration INT DEFAULT 30,          -- Daqiqada (standart: 30)
  service_id TEXT DEFAULT 'standard',
  service_name TEXT DEFAULT 'Barberxona xizmati',
  price NUMERIC DEFAULT 80000,
  status TEXT DEFAULT 'confirmed',   -- 'confirmed', 'completed', 'cancelled', 'pending'
  source TEXT DEFAULT 'web',         -- 'web', 'telegram', 'admin'
  chat_id BIGINT,                   -- Telegram foydalanuvchi ID si
  username TEXT,                    -- Telegram @username
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- DOUBLE BOOKINGNING OLDINI OLISH:
-- Faol bronlar orasida ayni bir sana va vaqtga faqat bitta yozuv bo'lishi mumkin!
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_booking 
ON bookings (date, time_slot) 
WHERE status != 'cancelled';

-- Tezkor qidiruv indekslari
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings (date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_chat_id ON bookings (chat_id);

-- 2. XIZMATLAR JADVALI (SERVICES)
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC NOT NULL DEFAULT 80000,
  duration INT DEFAULT 30,
  popular BOOLEAN DEFAULT false,
  active BOOLEAN DEFAULT true,
  category TEXT DEFAULT 'hair',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Standart xizmatlarni kiritish (agar mavjud bo'lmasa)
INSERT INTO services (id, name, description, price, duration, popular, active, category)
VALUES 
  ('srv-1', 'Klassik soch turmagi', 'Fade, Crop, Pompadour, soch yuvish va styling', 80000, 45, true, true, 'hair'),
  ('srv-2', 'Soqol tekislash va parvarish', 'Issiq sochiq, qirqish, chiziq berish va maxsus moy bilan massaj', 50000, 30, false, true, 'beard'),
  ('srv-3', 'VIP Kompleks (Soch + Soqol + Mask)', 'Soch va soqol dizayni, yuz bug‘lash, tozalovchi niqob va styling', 140000, 75, true, true, 'combo'),
  ('srv-4', 'Bolalar soch turmagi (12 yoshgacha)', 'Kichik yoshdagi mijozlar uchun muloyim va qiziqarli xizmat', 60000, 35, false, true, 'hair'),
  ('srv-5', 'Yuz parvarishi va qora niqob', 'Yuz terisini chuqur tozalash, qora nuqtalarni ketkazish va namlantirish', 45000, 25, false, true, 'spa')
ON CONFLICT (id) DO NOTHING;

-- 3. SOZLAMALAR JADVALI (SETTINGS)
CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  shop_name TEXT DEFAULT 'Doniyor Barber',
  barber_name TEXT DEFAULT 'Doniyor Barber',
  phone TEXT DEFAULT '+998 90 123 45 67',
  address TEXT DEFAULT 'Urganch tuman',
  landmark TEXT DEFAULT 'Urganch tuman',
  location TEXT DEFAULT 'Urganch tuman',
  start_time TEXT DEFAULT '09:00',
  end_time TEXT DEFAULT '21:00',
  telegram_bot TEXT DEFAULT '@DoniyorBarber_Bot',
  website_url TEXT DEFAULT 'http://127.0.0.1:3000',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO settings (id, shop_name, barber_name, phone, address, landmark, location, start_time, end_time, telegram_bot, website_url)
VALUES ('default', 'Doniyor Barber', 'Doniyor Barber', '+998 90 123 45 67', 'Urganch tuman', 'Urganch tuman', 'Urganch tuman', '09:00', '21:00', '@DoniyorBarber_Bot', 'http://127.0.0.1:3000')
ON CONFLICT (id) DO NOTHING;

-- 4. BLOKLANGAN VAQTLAR (BLOCKED SLOTS)
CREATE TABLE IF NOT EXISTS blocked_slots (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  duration INT DEFAULT 30,
  reason TEXT DEFAULT 'Shaxsiy sabab',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) SOZLAMALARI
-- Ommaviy mijozlar va bot erkin ma'lumot o'qishi va bron yaratishi uchun
-- ====================================================================

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_slots ENABLE ROW LEVEL SECURITY;

-- Bookings RLS
DROP POLICY IF EXISTS "Public select bookings" ON bookings;
CREATE POLICY "Public select bookings" ON bookings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public insert bookings" ON bookings;
CREATE POLICY "Public insert bookings" ON bookings FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Public update bookings" ON bookings;
CREATE POLICY "Public update bookings" ON bookings FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Public delete bookings" ON bookings;
CREATE POLICY "Public delete bookings" ON bookings FOR DELETE USING (true);

-- Services RLS
DROP POLICY IF EXISTS "Public all services" ON services;
CREATE POLICY "Public all services" ON services FOR ALL USING (true);

-- Settings RLS
DROP POLICY IF EXISTS "Public all settings" ON settings;
CREATE POLICY "Public all settings" ON settings FOR ALL USING (true);

-- Blocked Slots RLS
DROP POLICY IF EXISTS "Public all blocked_slots" ON blocked_slots;
CREATE POLICY "Public all blocked_slots" ON blocked_slots FOR ALL USING (true);

-- ====================================================================
-- REALTIME TIZIMINI YOQISH
-- Web sayt va Telegram bot real vaqtda bir-birini yangilab turishi uchun
-- ====================================================================
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE bookings;
  EXCEPTION WHEN others THEN NULL; END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE settings;
  EXCEPTION WHEN others THEN NULL; END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE blocked_slots;
  EXCEPTION WHEN others THEN NULL; END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE services;
  EXCEPTION WHEN others THEN NULL; END;
END $$;
