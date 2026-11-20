/**
 * ระบบบันทึกเลขไมล์รถบริษัท — หลังบ้าน (Google Apps Script)
 * วิธีติดตั้งดูใน README.md
 *
 * ⚠️ ใส่ค่าจริง (PIN, LINE token) ในหน้า Apps Script เท่านั้น
 *    อย่า commit ไฟล์ที่มีค่าจริงกลับขึ้น GitHub
 */
const CONFIG = {
  // รถบริษัท (id ห้ามซ้ำ และห้ามเปลี่ยนหลังเริ่มใช้งาน)
  // fuel = ชนิดน้ำมัน: diesel, b20, g95, g91, e20, e85, premium_diesel, premium_95
  // kmPerLiter = อัตราสิ้นเปลืองโดยประมาณ (กม./ลิตร) ใช้ประมาณค่าน้ำมันต่อเที่ยว
  CARS: [
    { id: 'car1', name: 'Toyota Hilux Revo', plate: 'กข 1234 กรุงเทพมหานคร', fuel: 'diesel', kmPerLiter: 12 },
    { id: 'car2', name: 'Toyota Yaris Ativ', plate: '1กค 5678 กรุงเทพมหานคร', fuel: 'g95', kmPerLiter: 17 },
  ],
  // รายชื่อพนักงานที่ใช้รถได้
  // PIN ของแต่ละคนต้องไม่ซ้ำกัน แนะนำ 6 หลัก (ระบบรู้ว่าใครใช้รถจาก PIN นี้)
  DRIVERS: [
    { name: 'สมชาย',   pin: '111111' },
    { name: 'สมหญิง',  pin: '222222' },
    { name: 'สมศักดิ์', pin: '333333' },
  ],

  ADMIN_PIN: '9999',  // PIN สำหรับดูรายงาน

  // ที่ตั้งบริษัท ใช้คำนวณระยะทางไป-กลับ และตรวจว่าคืนรถที่บริษัทหรือไม่
  // เปิด Google Maps > คลิกขวาที่บริษัท > คัดลอกพิกัด
  // ตั้งจากหน้าเว็บได้ (หน้ารายงาน → ที่ตั้งบริษัท) หรือใส่ตัวเลขตรงนี้ก็ได้ ถ้าใส่ตรงนี้จะใช้ค่านี้ก่อน
  COMPANY_LAT: null,   // เช่น 13.7563
  COMPANY_LNG: null,   // เช่น 100.5018
  RETURN_RADIUS_KM: 1, // คืนรถห่างจากบริษัทเกินนี้ = แจ้งเตือน

  // เวลางาน (วัน 1=จันทร์ ... 7=อาทิตย์)
  WORK_START: 7,
  WORK_END: 19,
  WORK_DAYS: [1, 2, 3, 4, 5],

  ODO_GAP_TOLERANCE_KM: 2,   // เลขไมล์ไม่ต่อกันเกินนี้ = แจ้งเตือน
  EXTRA_DISTANCE_PCT: 30,    // วิ่งเกินระยะ Google Maps เกินกี่ %
  EXTRA_DISTANCE_MIN_KM: 10, // และต้องเกินอย่างน้อยกี่ กม. ถึงจะแจ้งเตือน
  MAX_TRIP_HOURS: 10,        // ใช้รถนานเกินนี้ = แจ้งเตือน
  PHOTO_MAX_AGE_MIN: 15,     // รูปเลขไมล์เก่ากว่านี้ (ไม่ได้ถ่ายสด) = แจ้งเตือน
  FUEL_PRICE_TOLERANCE_PCT: 5,
  REQUIRE_RECEIPT: true,
  // GPS จากมือถือ (โหมดกำลังขับ)
  GPS_REQUIRED: true,        // ไม่มีข้อมูล GPS เลย = แจ้งเตือน
  GPS_GAP_MIN: 10,           // GPS ขาดช่วงนานกว่านี้ (นาที) = แจ้งเตือน
  GPS_OFFROUTE_KM: 5,        // ออกห่างจากเส้นทางที่วางไว้เกินนี้ (กม.) = แจ้งเตือน     // เติมน้ำมันแล้วต้องถ่ายรูปใบเสร็จ (อ่านตัวเลขอัตโนมัติ ต้องเปิด Drive API ดู README) // ยอดเงินเติมน้ำมันต่างจาก ลิตร × ราคาวันนี้ เกินกี่ % = แจ้งเตือน

  // LINE Official Account (Messaging API) — เว้นว่างถ้ายังไม่ใช้
  LINE_CHANNEL_TOKEN: '',
  LINE_NOTIFY_ALL: true, // true = แจ้งทุกครั้งที่รับ/คืนรถ, false = แจ้งเฉพาะเมื่อมีความผิดปกติ

  TIMEZONE: 'Asia/Bangkok',
};

const HEADERS = ['id', 'status', 'car', 'driver', 'purpose', 'destination',
  'startTime', 'startOdo', 'startPhoto', 'startLat', 'startLng', 'expectedKm',
  'endTime', 'endOdo', 'endPhoto', 'endLat', 'endLng', 'distance',
  'fuelLiters', 'fuelBaht', 'note', 'flags', 'stopsJson', 'fuelType', 'fuelPrice', 'fuelCostEst',
  'receiptPhoto', 'receiptLiters', 'receiptBaht', 'receiptDate',
  'gpsKm', 'gpsPoints', 'gpsMaxGapMin', 'gpsOffrouteKm',
  'returnedBy', 'reviewStatus', 'reviewNote', 'reviewAt'];
const TRACK_HEADERS = ['tripId', 'time', 'lat', 'lng', 'acc'];

// ชนิดน้ำมัน → คำที่ใช้จับชื่อในประกาศราคาของบางจาก
const FUEL_TYPES = {
  diesel:         { label: 'ดีเซล',                has: ['ดีเซล'], not: ['B20', 'พรีเมียม'] },
  b20:            { label: 'ดีเซล B20',            has: ['B20'] },
  premium_diesel: { label: 'ดีเซลพรีเมียม',         has: ['พรีเมียม', 'ดีเซล'] },
  g95:            { label: 'แก๊สโซฮอล์ 95',        has: ['แก๊สโซฮอล์ 95'] },
  g91:            { label: 'แก๊สโซฮอล์ 91',        has: ['แก๊สโซฮอล์ 91'] },
  e20:            { label: 'แก๊สโซฮอล์ E20',       has: ['E20'] },
  e85:            { label: 'แก๊สโซฮอล์ E85',       has: ['E85'] },
  premium_95:     { label: 'เบนซินพรีเมียม 98',     has: ['98'] },
};

// ---------- Web App entry ----------
function doGet() {
  return json_({ ok: true, msg: 'Fleet mileage API is running' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
  if (body.events) return lineWebhook_(body); // ข้อความจาก LINE

  try {
    let who;
    switch (body.action) {
      case 'login':      return ok_(login_(body.pin));
      case 'init':       auth_(body.pin, false); return ok_(init_());
      case 'checkout':   who = auth_(body.pin, false); return ok_(withLock_(() => checkout_(body, who)));
      case 'checkin':    who = auth_(body.pin, false); return ok_(withLock_(() => checkin_(body, who)));
      case 'review':     auth_(body.pin, true);  return ok_(withLock_(() => review_(body)));
      case 'route':      auth_(body.pin, false); return ok_(route_(body.stops));
      case 'track':      auth_(body.pin, false); return ok_(withLock_(() => saveTrack_(body)));
      case 'live':       auth_(body.pin, true);  return ok_(live_());
      case 'trackGet':   auth_(body.pin, true);  return ok_(getTrack_(body.tripId));
      case 'receipt':    auth_(body.pin, false); return ok_(readReceipt_(body.photo));
      case 'fuel':       auth_(body.pin, false); return ok_(fuelPrices_());
      case 'place':      auth_(body.pin, false); return ok_(findPlace_(body.q));
      case 'setCompany': auth_(body.pin, true);  return ok_(setCompany_(body));
      case 'adminCheck': auth_(body.pin, true);  return ok_(true);
      case 'trips':      auth_(body.pin, true);  return ok_(readTrips_().map(pub_).reverse());
      default: throw new Error('unknown action');
    }
  } catch (err) {
    return json_({ ok: false, error: err.message });
  }
}

// ---------- Actions ----------
function init_() {
  const trips = readTrips_();
  return {
    drivers: driverNames_(),
    fuel: fuelPrices_(),
    rules: {
      workStart: CONFIG.WORK_START, workEnd: CONFIG.WORK_END, workDays: CONFIG.WORK_DAYS,
      gapKm: CONFIG.ODO_GAP_TOLERANCE_KM, extraPct: CONFIG.EXTRA_DISTANCE_PCT,
      extraMinKm: CONFIG.EXTRA_DISTANCE_MIN_KM, requireReceipt: CONFIG.REQUIRE_RECEIPT,
      gpsRequired: CONFIG.GPS_REQUIRED, gpsGapMin: CONFIG.GPS_GAP_MIN, offrouteKm: CONFIG.GPS_OFFROUTE_KM,
      company: company_(),
    },
    cars: CONFIG.CARS.map(c => {
      const ct = trips.filter(t => t.car === c.id);
      const open = ct.find(t => t.status === 'open');
      return Object.assign({}, c, { open: open ? pub_(open) : null, lastOdo: lastOdo_(ct) });
    }),
  };
}

function checkout_(b, who) {
  const car = carById_(b.car);
  // ชื่อคนใช้รถมาจาก PIN เสมอ (ผู้ดูแลเท่านั้นที่ระบุชื่อแทนคนอื่นได้)
  b.driver = who && !who.admin ? who.name : b.driver;
  if (driverNames_().indexOf(b.driver) < 0) throw new Error('ไม่พบชื่อผู้ใช้รถ');
  const odo = Number(b.odo);
  if (!(odo > 0)) throw new Error('กรุณากรอกเลขไมล์');
  if (!b.photo) throw new Error('กรุณาถ่ายรูปหน้าปัดเลขไมล์');
  if (!String(b.purpose || '').trim()) throw new Error('กรุณาระบุวัตถุประสงค์');

  const carTrips = readTrips_().filter(t => t.car === car.id);
  if (carTrips.some(t => t.status === 'open')) throw new Error('รถคันนี้ยังไม่ได้คืน');

  const flags = [];
  const last = lastOdo_(carTrips);
  if (last !== null) {
    if (odo < last) flags.push(`เลขไมล์ต่ำกว่าตอนคืนรถครั้งก่อน (${fmt_(last)})`);
    else if (odo - last > CONFIG.ODO_GAP_TOLERANCE_KM) flags.push(`มี ${fmt_(odo - last)} กม. ที่ไม่ได้บันทึก (คืนรถครั้งก่อนที่ ${fmt_(last)})`);
  }
  const now = new Date();
  if (outsideHours_(now)) flags.push('นำรถออกนอกเวลางาน');
  photoAgeFlag_(b.photoAgeMin, 'รับรถ', flags);

  const id = Utilities.getUuid().slice(0, 8);
  const stops = normStops_(b.stops && b.stops.length ? b.stops : b.destination);
  const expectedKm = estimateKm_(stops);
  const trip = {
    id, status: 'open', car: car.id, driver: b.driver,
    purpose: String(b.purpose).trim(), destination: stops.map(x => x.name).join('\n'),
    stopsJson: JSON.stringify(stops),
    startTime: now, startOdo: odo, startPhoto: savePhoto_(b.photo, `${car.id}_${id}_start`),
    startLat: num_(b.lat), startLng: num_(b.lng), expectedKm,
    flags: flags.join(' | '),
  };
  sheet_().appendRow(HEADERS.map(h => trip[h] === undefined || trip[h] === null ? '' : trip[h]));

  if (CONFIG.LINE_NOTIFY_ALL || flags.length) {
    notify_(['🚗 นำรถออก',
      `รถ: ${car.name} (${car.plate})`,
      `ผู้ใช้: ${b.driver}`,
      `งาน: ${trip.purpose}`,
      trip.destination ? 'ไป:\n' + trip.destination.split('\n').map((x, i) => `  ${i + 1}. ${x}`).join('\n') : '',
      `เลขไมล์ตอนออก: ${fmt_(odo)}`,
      expectedKm ? `ระยะไป-กลับ (Google Maps): ~${expectedKm} กม.\nกลับถึงบริษัทเลขไมล์ควรประมาณ: ${fmt_(odo + expectedKm)}` : '',
    ].concat(flags.map(f => '⚠️ ' + f)).filter(String).join('\n'));
  }
  return { id, flags, expectedKm };
}

function checkin_(b, who) {
  const t = readTrips_().find(x => x.id === b.tripId && x.status === 'open');
  if (!t) throw new Error('ไม่พบรายการที่ยังไม่คืน (อาจถูกคืนไปแล้ว)');
  const car = carById_(t.car);
  const odo = Number(b.odo);
  if (!(odo > 0)) throw new Error('กรุณากรอกเลขไมล์');
  if (odo < Number(t.startOdo)) throw new Error(`เลขไมล์ต้องไม่น้อยกว่าตอนรับรถ (${fmt_(t.startOdo)})`);
  if (!b.photo) throw new Error('กรุณาถ่ายรูปหน้าปัดเลขไมล์');

  const now = new Date();
  const start = new Date(t.startTime);
  const dist = odo - Number(t.startOdo);
  const flags = t.flags ? String(t.flags).split(' | ') : [];
  const exp = Number(t.expectedKm);
  if (exp > 0 && dist > exp * (1 + CONFIG.EXTRA_DISTANCE_PCT / 100) && dist - exp >= CONFIG.EXTRA_DISTANCE_MIN_KM) {
    flags.push(`วิ่งจริง ${fmt_(dist)} กม. แต่ Google Maps คำนวณไว้ ~${exp} กม. (เกิน ${fmt_(dist - exp)} กม.) · เลขไมล์ควรจบที่ ~${fmt_(Number(t.startOdo) + exp)}`);
  }
  const hours = (now - start) / 36e5;
  if (dayKey_(now) !== dayKey_(start)) flags.push('ไม่คืนรถภายในวันเดียวกัน');
  else if (hours > CONFIG.MAX_TRIP_HOURS) flags.push(`ใช้รถนาน ${hours.toFixed(1)} ชม.`);
  if (outsideHours_(now)) flags.push('คืนรถนอกเวลางาน');
  const C = company_();
  if (C) {
    const lat = num_(b.lat), lng = num_(b.lng);
    if (lat === '') flags.push('ไม่ได้รับพิกัดตอนคืนรถ');
    else {
      const d = haversine_(lat, lng, C.lat, C.lng);
      if (d > CONFIG.RETURN_RADIUS_KM) flags.push(`คืนรถห่างจากบริษัท ${d.toFixed(1)} กม.`);
    }
  }
  photoAgeFlag_(b.photoAgeMin, 'คืนรถ', flags);

  // น้ำมัน: ใช้ราคาจริงวันนี้ตรวจยอดเงิน และประมาณค่าน้ำมันของเที่ยวนี้
  const fp = fuelPrices_();
  const fuelType = FUEL_TYPES[b.fuelType] ? b.fuelType : (car.fuel || '');
  const price = fp && fp.prices[fuelType] ? fp.prices[fuelType] : '';
  const L = Number(b.fuelLiters) || 0, baht = Number(b.fuelBaht) || 0;
  if (price && L > 0 && baht > 0) {
    const should = L * price, diff = (baht - should) / should * 100;
    if (Math.abs(diff) > CONFIG.FUEL_PRICE_TOLERANCE_PCT) {
      flags.push(`ยอดเติมน้ำมัน ${fmt_(baht)} บาท ไม่ตรงกับ ${L} ลิตร × ${price} บาท = ${fmt_(Math.round(should))} บาท (ต่าง ${diff > 0 ? '+' : ''}${diff.toFixed(0)}%)`);
    }
  }
  const fuelCostEst = price && car.kmPerLiter ? Math.round(dist / car.kmPerLiter * price) : '';

  // ใบเสร็จ: เก็บรูป แล้วอ่านตัวเลขเองอีกรอบ เทียบกับที่กรอก และเช็กวันที่ในใบเสร็จ
  let receiptPhoto = '', rc = {};
  if (L > 0 && CONFIG.REQUIRE_RECEIPT && !b.receipt) throw new Error('กรุณาถ่ายรูปใบเสร็จน้ำมัน');
  if (b.receipt) {
    receiptPhoto = savePhoto_(b.receipt, `${car.id}_${t.id}_receipt`);
    try { rc = readReceipt_(b.receipt); } catch (e) { console.warn('receipt', e); }
    if (rc.liters && L && Math.abs(rc.liters - L) > 0.1 || rc.baht && baht && Math.abs(rc.baht - baht) > 1) {
      flags.push(`ตัวเลขที่กรอก (${L} ลิตร ${fmt_(baht)} บาท) ไม่ตรงกับใบเสร็จ (${rc.liters || '?'} ลิตร ${rc.baht ? fmt_(rc.baht) : '?'} บาท)`);
    }
    if (rc.date && rc.date !== dayKey_(start) && rc.date !== dayKey_(now)) {
      flags.push(`วันที่ในใบเสร็จ (${rc.date}) ไม่ตรงกับวันที่ใช้รถ`);
    }
  }

  // GPS: เทียบเส้นทางจริงกับแผน
  const g = gpsStats_(t, now);
  if (!g.points) { if (CONFIG.GPS_REQUIRED) flags.push('ไม่ได้เปิดบันทึกเส้นทาง GPS ระหว่างใช้รถ'); }
  else {
    if (g.maxGapMin >= CONFIG.GPS_GAP_MIN) flags.push(`GPS ขาดช่วงนานสุด ${g.maxGapMin} นาที (${g.gapAt}) อาจปิดหน้าจอหรือปิดเว็บระหว่างขับ`);
    if (g.offrouteKm != null && g.offrouteKm > CONFIG.GPS_OFFROUTE_KM) flags.push(`รถออกนอกเส้นทางที่วางไว้ ไกลสุด ${g.offrouteKm} กม. (เวลา ${g.offrouteAt})`);
    if (dist > g.km * 1.3 + 10 && g.maxGapMin < CONFIG.GPS_GAP_MIN) flags.push(`เลขไมล์ ${fmt_(dist)} กม. มากกว่าระยะจาก GPS (${g.km} กม.)`);
  }

  setCells_(t._row, {
    gpsKm: g.points ? g.km : '', gpsPoints: g.points, gpsMaxGapMin: g.points ? g.maxGapMin : '', gpsOffrouteKm: g.offrouteKm != null ? g.offrouteKm : '',
    status: 'closed', endTime: now, endOdo: odo,
    endPhoto: savePhoto_(b.photo, `${car.id}_${t.id}_end`),
    endLat: num_(b.lat), endLng: num_(b.lng), distance: dist,
    fuelLiters: num_(b.fuelLiters), fuelBaht: num_(b.fuelBaht),
    note: String(b.note || '').trim(), flags: flags.join(' | '),
    fuelType: L > 0 ? fuelType : '', fuelPrice: L > 0 ? price : '', fuelCostEst,
    returnedBy: who ? (who.admin ? 'ผู้ดูแล' : who.name) : '',
    receiptPhoto, receiptLiters: rc.liters || '', receiptBaht: rc.baht || '', receiptDate: rc.date || '',
  });

  if (CONFIG.LINE_NOTIFY_ALL || flags.length) {
    notify_([flags.length ? '⚠️ คืนรถ (มีรายการต้องตรวจสอบ)' : '✅ คืนรถ',
      `รถ: ${car.name} (${car.plate})`,
      `ผู้ใช้: ${t.driver}`,
      `ระยะทางจริง: ${fmt_(dist)} กม.` + (exp > 0 ? ` (Google Maps ~${exp} กม.)` : ''),
      `เลขไมล์: ${fmt_(t.startOdo)} → ${fmt_(odo)}` + (exp > 0 ? ` (ควรประมาณ ${fmt_(Number(t.startOdo) + exp)})` : ''),
      g.points ? `GPS: ${g.km} กม. ขาดช่วงนานสุด ${g.maxGapMin} นาที` : 'GPS: ไม่มีข้อมูล',
      fuelCostEst ? `ค่าน้ำมันเที่ยวนี้ประมาณ: ${fmt_(fuelCostEst)} บาท` : '',
      L ? `เติมน้ำมัน: ${L} ลิตร ${baht ? fmt_(baht) + ' บาท' : ''}${price ? ` (ราคาวันนี้ ${price} บาท/ลิตร)` : ''}` : '',
    ].concat(flags.map(f => '⚠️ ' + f)).filter(String).join('\n'));
  }
  return { id: t.id, distance: dist, flags, fuelCostEst };
}

/**
 * ราคาน้ำมันขายปลีกวันนี้จากประกาศของบางจาก (กรุงเทพฯ ไม่รวมภาษีท้องถิ่น)
 * เก็บแคชไว้ 1 ชั่วโมง ถ้าดึงไม่ได้จะคืน null แล้วให้กรอกเองได้ตามปกติ
 */
function fuelPrices_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('fuel');
  if (hit) return JSON.parse(hit);
  try {
    const res = UrlFetchApp.fetch('https://oil-price.bangchak.co.th/ApiOilPrice2/th', { muteHttpExceptions: true });
    const d = JSON.parse(res.getContentText())[0];
    const list = JSON.parse(d.OilList);
    const prices = {};
    Object.keys(FUEL_TYPES).forEach(k => {
      const ft = FUEL_TYPES[k];
      const m = list.find(o => ft.has.every(w => o.OilName.indexOf(w) >= 0) && !(ft.not || []).some(w => o.OilName.indexOf(w) >= 0));
      if (m) prices[k] = Number(m.PriceToday);
    });
    const out = { prices, labels: Object.keys(FUEL_TYPES).reduce((o, k) => (o[k] = FUEL_TYPES[k].label, o), {}),
      source: 'บางจาก', note: d.OilRemark2 || '' };
    cache.put('fuel', JSON.stringify(out), 3600);
    return out;
  } catch (e) {
    console.warn('fuelPrices_', e);
    return null;
  }
}

// ---------- Helpers ----------
/** ตรวจ PIN แล้วคืนว่าเป็นใคร: { name } สำหรับพนักงาน หรือ { admin: true } */
function auth_(pin, admin) {
  pin = String(pin || '').trim();
  if (pin && pin === String(CONFIG.ADMIN_PIN)) return { admin: true, name: '' };
  const d = admin ? null : driverByPin_(pin);
  if (!d) { Utilities.sleep(700); throw new Error(admin ? 'PIN ผู้ดูแลไม่ถูกต้อง' : 'PIN ไม่ถูกต้อง'); }
  return { admin: false, name: d.name };
}
function driverByPin_(pin) {
  return pin ? CONFIG.DRIVERS.find(d => String(d.pin) === String(pin)) : null;
}
const driverNames_ = () => CONFIG.DRIVERS.map(d => d.name);
function login_(pin) {
  const d = driverByPin_(String(pin || '').trim());
  if (!d) { Utilities.sleep(1000); throw new Error('PIN ไม่ถูกต้อง'); }  // หน่วงเวลา กันการเดา PIN
  return { name: d.name };
}

/** ผู้ดูแลกด "ตรวจแล้ว" พร้อมบันทึก (กดซ้ำเพื่อแก้บันทึก หรือส่ง undo: true เพื่อยกเลิก) */
function review_(b) {
  const t = readTrips_().find(x => x.id === String(b.tripId));
  if (!t) throw new Error('ไม่พบรายการนี้');
  const v = b.undo ? { reviewStatus: '', reviewNote: '', reviewAt: '' }
    : { reviewStatus: 'done', reviewNote: String(b.note || '').trim().slice(0, 500), reviewAt: new Date() };
  setCells_(t._row, v);
  return { id: t.id, reviewStatus: v.reviewStatus, reviewNote: v.reviewNote, reviewAt: v.reviewAt ? v.reviewAt.toISOString() : '' };
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Trips');
  if (!sh) {
    sh = ss.insertSheet('Trips');
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  } else if (sh.getLastColumn() < HEADERS.length) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold'); // เพิ่มคอลัมน์ใหม่ให้ชีตเดิม
  }
  return sh;
}

function readTrips_() {
  const vals = sheet_().getDataRange().getValues();
  const head = vals.shift();
  return vals.filter(r => r[0] !== '').map((r, i) => {
    const o = { _row: i + 2 };
    head.forEach((h, j) => { o[h] = r[j] instanceof Date ? r[j].toISOString() : r[j]; });
    o.id = String(o.id);
    return o;
  });
}

function setCells_(row, obj) {
  const sh = sheet_();
  Object.keys(obj).forEach(k => {
    const col = HEADERS.indexOf(k) + 1;
    if (col > 0) sh.getRange(row, col).setValue(obj[k] === null || obj[k] === undefined ? '' : obj[k]);
  });
}

function pub_(t) { const o = Object.assign({}, t); delete o._row; return o; }

function carById_(id) {
  const c = CONFIG.CARS.find(x => x.id === id);
  if (!c) throw new Error('ไม่พบรถคันนี้');
  return c;
}

function lastOdo_(carTrips) {
  let m = null;
  carTrips.forEach(t => {
    const v = t.endOdo !== '' && t.endOdo !== null ? Number(t.endOdo) : Number(t.startOdo);
    if (!isNaN(v) && (m === null || v > m)) m = v;
  });
  return m;
}

function outsideHours_(d) {
  const h = Number(Utilities.formatDate(d, CONFIG.TIMEZONE, 'H'));
  const dow = Number(Utilities.formatDate(d, CONFIG.TIMEZONE, 'u'));
  return CONFIG.WORK_DAYS.indexOf(dow) < 0 || h < CONFIG.WORK_START || h >= CONFIG.WORK_END;
}

function dayKey_(d) { return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd'); }

function photoAgeFlag_(age, when, flags) {
  age = Number(age);
  if (age > CONFIG.PHOTO_MAX_AGE_MIN) flags.push(`รูปเลขไมล์ตอน${when}ไม่ได้ถ่ายตอนนี้ (เป็นรูปที่ถ่ายไว้ ${ageText_(age)}ก่อน อาจเลือกรูปเก่าจากอัลบั้ม)`);
}

function ageText_(min) {
  min = Math.round(Number(min));
  if (min < 60) return min + ' นาที';
  if (min < 48 * 60) return Math.round(min / 60) + ' ชั่วโมง';
  if (min < 60 * 1440) return Math.round(min / 1440) + ' วัน';
  if (min < 365 * 1440) return Math.round(min / 43200) + ' เดือน';
  return (min / 525600).toFixed(1).replace('.0', '') + ' ปี';
}

/** แปลงสถานที่ให้อยู่รูปแบบเดียวกัน: [{ name, address, lat, lng }] */
function normStops_(stops) {
  const arr = Array.isArray(stops) ? stops : String(stops || '').split(/[\n;]+/);
  return arr.map(x => typeof x === 'object' && x
    ? { name: String(x.name || '').trim(), address: String(x.address || ''), lat: num_(x.lat), lng: num_(x.lng) }
    : { name: String(x).trim(), address: '', lat: '', lng: '' })
    .filter(x => x.name || x.lat !== '').slice(0, 8);
}

/**
 * ค้นหาสถานที่จาก Google Maps (ฟรีผ่าน Apps Script)
 * รับได้ทั้งชื่อสถานที่ และลิงก์ที่แชร์จากแอป Google Maps
 */
function findPlace_(q) {
  q = String(q || '').trim();
  if (!q) throw new Error('พิมพ์ชื่อสถานที่ก่อน');
  if (/^https?:\/\//i.test(q)) return [placeFromLink_(q)];

  const g = Maps.newGeocoder().setRegion('th').setLanguage('th');
  const C = company_();
  if (C) {
    const d = 1.5; // ให้น้ำหนักกับสถานที่ใกล้บริษัท
    g.setBounds(C.lat - d, C.lng - d, C.lat + d, C.lng + d);
  }
  const r = g.geocode(q);
  return (r.results || []).slice(0, 5).map(x => {
    const poi = (x.types || []).some(t => ['establishment', 'point_of_interest', 'premise', 'shopping_mall', 'store'].indexOf(t) >= 0);
    const first = x.address_components && x.address_components[0] ? x.address_components[0].long_name : '';
    return {
      name: poi && first ? first : q,
      address: x.formatted_address,
      lat: x.geometry.location.lat, lng: x.geometry.location.lng,
    };
  });
}

/** อ่านพิกัดจากลิงก์ Google Maps (รองรับ maps.app.goo.gl และ google.com/maps) */
function placeFromLink_(url) {
  if (!/^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)\//i.test(url)) {
    throw new Error('ลิงก์นี้ไม่ใช่ลิงก์ Google Maps');
  }
  let u = url;
  for (let i = 0; i < 5; i++) { // ตามลิงก์ย่อจนได้ลิงก์เต็ม
    const res = UrlFetchApp.fetch(u, { followRedirects: false, muteHttpExceptions: true });
    const loc = res.getHeaders()['Location'] || res.getHeaders()['location'];
    if (!loc) break;
    u = loc;
  }
  u = decodeURIComponent(u);
  const m = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || u.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (!m) throw new Error('อ่านตำแหน่งจากลิงก์ไม่ได้ ลองกดแชร์จากหมุดสถานที่ในแอป Google Maps');
  const lat = Number(m[1]), lng = Number(m[2]);
  const nm = u.match(/\/place\/([^/@]+)/);
  let address = '';
  try { const rg = Maps.newGeocoder().setLanguage('th').reverseGeocode(lat, lng); address = rg.results[0].formatted_address; } catch (e) {}
  return { name: nm ? nm[1].replace(/\+/g, ' ') : 'ตำแหน่งจากลิงก์ Google Maps', address, lat, lng };
}

/**
 * คำนวณเส้นทางด้วย Google Maps: บริษัท → จุดที่ 1 → 2 → … → กลับบริษัท
 * คืนค่าระยะ/เวลาแยกทีละช่วง และระยะรวม (ใช้บริการ Maps ของ Apps Script ฟรี ไม่ต้องมี API key)
 */
function route_(stops) {
  stops = normStops_(stops);
  if (!stops.length) throw new Error('กรุณาใส่สถานที่อย่างน้อย 1 จุด');
  const C = company_();
  if (!C) throw new Error('ผู้ดูแลยังไม่ได้ตั้งที่ตั้งบริษัท (หน้ารายงาน → ที่ตั้งบริษัท) จึงยังคำนวณระยะทางไม่ได้');
  const key = 'r:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify([C, stops.map(x => [x.name, x.lat, x.lng])]), Utilities.Charset.UTF_8));
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const f = Maps.newDirectionFinder().setRegion('th').setLanguage('th')
    .setOrigin(C.lat, C.lng)
    .setDestination(C.lat, C.lng);
  stops.forEach(s => (s.lat !== '' && s.lng !== '') ? f.addWaypoint(s.lat, s.lng) : f.addWaypoint(s.name));
  const r = f.getDirections();
  if (!r.routes || !r.routes.length) throw new Error('Google Maps หาเส้นทางไม่เจอ ลองเลือกสถานที่ใหม่');
  const legs = r.routes[0].legs.map((l, i) => ({
    to: i < stops.length ? stops[i].name : 'กลับบริษัท',
    address: i < stops.length ? (stops[i].address || l.end_address) : '',
    km: Math.round(l.distance.value / 100) / 10,
    min: Math.round(l.duration.value / 60),
  }));
  const out = {
    legs,
    totalKm: Math.round(legs.reduce((s, l) => s + l.km, 0)),
    totalMin: legs.reduce((s, l) => s + l.min, 0),
  };
  cache.put(key, JSON.stringify(out), 21600);
  return out;
}

function estimateKm_(stops) {
  try { return route_(stops).totalKm; } catch (e) { console.warn('estimateKm_', e); return ''; }
}

function savePhoto_(dataUrl, name) {
  const m = String(dataUrl).match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (!m) throw new Error('ไฟล์รูปไม่ถูกต้อง');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name + '.jpg');
  return photoFolder_().createFile(blob).getUrl();
}

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* ถูกลบ สร้างใหม่ */ } }
  const f = DriveApp.createFolder('รูปเลขไมล์รถบริษัท');
  props.setProperty('PHOTO_FOLDER_ID', f.getId());
  return f;
}

function haversine_(a, b, c, d) {
  const R = 6371, r = x => x * Math.PI / 180;
  const s = Math.pow(Math.sin(r(c - a) / 2), 2) + Math.cos(r(a)) * Math.cos(r(c)) * Math.pow(Math.sin(r(d - b) / 2), 2);
  return 2 * R * Math.asin(Math.sqrt(s));
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function num_(v) { return v === '' || v === null || v === undefined || isNaN(Number(v)) ? '' : Number(v); }
function fmt_(n) { return Number(n).toLocaleString('en-US'); }
function ok_(data) { return json_({ ok: true, data }); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---------- LINE ----------
function notify_(text) {
  const token = CONFIG.LINE_CHANNEL_TOKEN;
  if (!token) return;
  const to = PropertiesService.getScriptProperties().getProperty('LINE_TO');
  const url = 'https://api.line.me/v2/bot/message/' + (to ? 'push' : 'broadcast');
  const payload = { messages: [{ type: 'text', text: text.slice(0, 4900) }] };
  if (to) payload.to = to;
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify(payload),
    });
    if (res.getResponseCode() !== 200) console.warn('LINE', res.getResponseCode(), res.getContentText());
  } catch (e) {
    console.warn('LINE error', e);
  }
}

/** พิมพ์ "ตั้งค่าแจ้งเตือน <ADMIN_PIN>" ในกลุ่ม LINE ที่มีบอทอยู่ เพื่อให้แจ้งเตือนเข้ากลุ่มนั้น */
function lineWebhook_(body) {
  (body.events || []).forEach(ev => {
    if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;
    const txt = ev.message.text.trim();
    if (txt !== 'ตั้งค่าแจ้งเตือน ' + CONFIG.ADMIN_PIN) return;
    const src = ev.source || {};
    PropertiesService.getScriptProperties().setProperty('LINE_TO', src.groupId || src.roomId || src.userId);
    lineReply_(ev.replyToken, '✅ ตั้งค่าแล้ว ต่อไปแจ้งเตือนการใช้รถจะส่งมาที่แชทนี้');
  });
  return ContentService.createTextOutput('OK');
}

function lineReply_(replyToken, text) {
  if (!CONFIG.LINE_CHANNEL_TOKEN) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + CONFIG.LINE_CHANNEL_TOKEN },
    payload: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  });
}

/** กด Run ฟังก์ชันนี้ในหน้า Apps Script เพื่อทดสอบส่ง LINE */
function testLine() {
  notify_('ทดสอบแจ้งเตือนจากระบบบันทึกเลขไมล์รถบริษัท 🚗');
}

// ---------- อ่านใบเสร็จน้ำมัน (OCR ของ Google Drive ฟรี) ----------
// ต้องเปิด Drive API: ในหน้า Apps Script กด "บริการ" (+) → เลือก Drive API → เพิ่ม
function readReceipt_(dataUrl) {
  const text = ocrImage_(dataUrl);
  const fp = fuelPrices_();
  const r = parseFuelReceipt_(text, fp ? Object.keys(fp.prices).map(k => fp.prices[k]) : []);
  r.found = !!(r.liters || r.baht);
  return r;
}

function ocrImage_(dataUrl) {
  const m = String(dataUrl).match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (!m) throw new Error('ไฟล์รูปไม่ถูกต้อง');
  if (typeof Drive === 'undefined') throw new Error('ยังไม่ได้เปิด Drive API ใน Apps Script จึงอ่านใบเสร็จอัตโนมัติไม่ได้ กรอกตัวเลขเองได้เลย');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], 'receipt.jpg');
  let id;
  if (Drive.Files.create) { // Drive API v3
    id = Drive.Files.create({ name: 'ocr-temp-receipt', mimeType: 'application/vnd.google-apps.document' }, blob, { ocrLanguage: 'th' }).id;
  } else {                  // Drive API v2
    id = Drive.Files.insert({ title: 'ocr-temp-receipt' }, blob, { ocr: true, ocrLanguage: 'th' }).id;
  }
  try { return DocumentApp.openById(id).getBody().getText(); }
  finally { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} }
}

/**
 * อ่านตัวเลขจากข้อความในใบเสร็จน้ำมัน (ข้อความได้จาก OCR ของ Google Drive)
 * วิธีหลัก: หาชุดตัวเลข ลิตร × ราคาต่อลิตร ≈ ยอดเงิน ที่อยู่ในใบเสร็จ
 * ถ้าหาไม่เจอ ค่อยใช้คำนำหน้า เช่น "ลิตร" "รวม" "TOTAL"
 */
function parseFuelReceipt_(text, knownPrices) {
  const out = parseFuelNumbers_(text, knownPrices);
  out.date = parseReceiptDate_(text);
  return out;
}

/** วันที่ในใบเสร็จ รองรับ 10/11/2026, 10/11/69 (พ.ศ.), 10-11-2569 → 'yyyy-mm-dd' */
function parseReceiptDate_(text) {
  const m = String(text || '').match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (!m) return '';
  let d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  if (y > 2400) y -= 543;
  else if (y < 100) y = y >= 50 ? 2500 + y - 543 : 2000 + y;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function parseFuelNumbers_(text, knownPrices) {
  const t = String(text || '').replace(/\r/g, '').replace(/(\d),(\d{3})/g, '$1$2');
  const known = (knownPrices || []).filter(Number);
  const toks = [];
  const reNum = /\d+\.\d{1,3}/g; let mm;
  while ((mm = reNum.exec(t))) {
    const before = t.slice(Math.max(0, mm.index - 18), mm.index), after = t.slice(mm.index + mm[0].length, mm.index + mm[0].length + 8);
    toks.push({
      v: Number(mm[0]), dec: mm[0].split('.')[1].length,
      priceHint: /(@|ราคา|PRICE|บาท\s*\/\s*ลิตร|\/\s*L)/i.test(before) || /^\s*(บาท\s*\/\s*ลิตร|\/\s*L)/i.test(after),
      literHint: /^\s*(ลิตร|ล\.|L\b|LTR|LITRE|LITER)/i.test(after) || /(VOLUME|ปริมาณ|LTR|LITRE|LITER|\(L\))[^\d\n]*$/i.test(before),
    });
  }
  // คะแนนว่าตัวเลขนี้น่าจะเป็น "ราคาต่อลิตร" แค่ไหน
  const priceScore = x => (x.v >= 20 && x.v <= 80 ? 1 : -9) + (x.priceHint ? 4 : 0) - (x.literHint ? 4 : 0)
    + (known.some(k => Math.abs(k - x.v) <= 1.5) ? 3 : 0) + (x.dec === 2 ? 0.5 : 0);

  let best = null;
  toks.forEach(a => toks.forEach(b => {
    if (a === b || a.v === b.v) return;
    const prod = a.v * b.v;
    toks.forEach(c => {
      if (c === a || c === b) return;
      const err = Math.abs(prod - c.v);
      if (err > Math.max(1.5, c.v * 0.005)) return;
      // a = ราคา, b = ลิตร
      const score = priceScore(a) - priceScore(b) - err;
      if (b.v < 0.5 || b.v > 300 || a.v < 20 || a.v > 80) return;
      if (!best || score > best.score) best = { price: a.v, liters: b.v, baht: c.v, score };
    });
  }));
  if (best) return { liters: best.liters, baht: best.baht, price: best.price, sure: true };

  const grab = re => { const m = t.match(re); return m ? Number(m[1]) : null; };
  const liters = grab(/(\d+\.\d{2,3})\s*(?:ลิตร|ล\.|L\b|LTR|LITRE|LITER)/i)
    || grab(/(?<!\/\s*)(?<!ต่อ\s*)(?:ลิตร|LTR|LITRE|LITER|VOLUME|ปริมาณ)[^\d\n]{0,20}(\d+\.\d{2,3})/i);
  const price = grab(/(?:บาท\s*\/\s*ลิตร|ราคา\s*\/?\s*ลิตร|ราคาต่อลิตร|UNIT\s*PRICE|PRICE|@)[^\d\n]{0,15}(\d{2}\.\d{2})/i);
  let baht = null;
  const re = /(?:รวมเงิน|ยอดรวม|ยอดเงิน|รวม|จำนวนเงิน|TOTAL|AMOUNT|NET)[^\d\n]{0,25}(\d+\.\d{2})/gi;
  let m; while ((m = re.exec(t))) { const v = Number(m[1]); if (!baht || v > baht) baht = v; }
  const r2 = x => Math.round(x * 100) / 100;
  if (liters && price && !baht) return { liters, baht: r2(liters * price), price, sure: false };
  if (baht && price && !liters) return { liters: r2(baht / price), baht, price, sure: false };
  if (baht && liters && !price) return { liters, baht, price: r2(baht / liters), sure: false };
  return { liters, baht, price, sure: false };
}



// ---------- GPS จากมือถือ ----------
function trackSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Track');
  if (!sh) { sh = ss.insertSheet('Track'); sh.appendRow(TRACK_HEADERS); sh.setFrozenRows(1); }
  return sh;
}

function saveTrack_(b) {
  const t = readTrips_().find(x => x.id === String(b.tripId));
  if (!t) throw new Error('ไม่พบรายการใช้รถนี้');
  if (t.status !== 'open' && (!t.endTime || new Date() - new Date(t.endTime) > 15 * 60000)) throw new Error('รายการนี้คืนรถไปแล้ว');
  const start = new Date(t.startTime).getTime() - 5 * 60000, now = Date.now() + 5 * 60000;
  const rows = (b.points || []).slice(0, 2000)
    .filter(p => p && isFinite(p.lat) && isFinite(p.lng) && p.t >= start && p.t <= now)
    .map(p => [t.id, new Date(p.t), Number(p.lat), Number(p.lng), Math.round(Number(p.acc) || 0)]);
  if (rows.length) {
    const sh = trackSheet_(); sh.getRange(sh.getLastRow() + 1, 1, rows.length, TRACK_HEADERS.length).setValues(rows);
    // เก็บจุดล่าสุดไว้ในแคช ให้หน้าติดตามสดอ่านได้เร็วโดยไม่ต้องเปิดทั้งชีต
    const cache = CacheService.getScriptCache(), key = 'trk:' + t.id;
    let pts = []; try { pts = JSON.parse(cache.get(key) || '[]'); } catch (e) {}
    rows.forEach(r => pts.push([r[1].getTime(), +r[2].toFixed(5), +r[3].toFixed(5)]));
    pts.sort((a, b) => a[0] - b[0]);
    while (JSON.stringify(pts).length > 90000) pts = pts.filter((p, i) => i % 2 === 0 || i > pts.length - 60);
    cache.put(key, JSON.stringify(pts), 21600);
  }
  return { saved: rows.length };
}

function readTrack_(tripId) {
  const vals = trackSheet_().getDataRange().getValues(); vals.shift();
  return vals.filter(r => String(r[0]) === String(tripId))
    .map(r => ({ t: new Date(r[1]).getTime(), lat: Number(r[2]), lng: Number(r[3]), acc: Number(r[4]) }))
    .sort((a, b) => a.t - b.t);
}

function getTrack_(tripId) {
  const t = readTrips_().find(x => x.id === String(tripId));
  let pts = readTrack_(tripId);
  const step = Math.ceil(pts.length / 800) || 1;
  pts = pts.filter((p, i) => i % step === 0 || i === pts.length - 1);
  let stops = [];
  try { stops = JSON.parse(t && t.stopsJson || '[]'); } catch (e) {}
  return { points: pts, stops, company: company_() };
}

/** สรุป GPS ของเที่ยว: ระยะ, ช่วงที่ขาด, ระยะที่ออกนอกเส้นทาง (เทียบเส้นตรงบริษัท→จุดแวะ→บริษัท) */
function gpsStats_(t, endTime) {
  const pts = readTrack_(t.id);
  const out = { points: pts.length, km: 0, maxGapMin: 0, gapAt: '', offrouteKm: null, offrouteAt: '' };
  if (!pts.length) return out;
  const fmtT = ms => Utilities.formatDate(new Date(ms), CONFIG.TIMEZONE, 'HH:mm');
  const edges = [new Date(t.startTime).getTime()].concat(pts.map(p => p.t), [endTime.getTime()]);
  for (let i = 1; i < edges.length; i++) {
    const gap = Math.round((edges[i] - edges[i - 1]) / 60000);
    if (gap > out.maxGapMin) { out.maxGapMin = gap; out.gapAt = `${fmtT(edges[i - 1])}–${fmtT(edges[i])} น.`; }
  }
  for (let i = 1; i < pts.length; i++) {
    const d = haversine_(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
    const h = (pts[i].t - pts[i - 1].t) / 36e5;
    if (d >= 0.02 && (h <= 0 || d / h < 200)) out.km += d;
  }
  out.km = Math.round(out.km * 10) / 10;

  let stops = [];
  try { stops = JSON.parse(t.stopsJson || '[]').filter(s => s.lat !== '' && s.lng !== ''); } catch (e) {}
  const c = company_();
  if (c && stops.length) {
    const path = [c].concat(stops.map(s => ({ lat: Number(s.lat), lng: Number(s.lng) })), [c]);
    let worst = 0, at = 0;
    pts.forEach(p => {
      let best = Infinity;
      for (let i = 1; i < path.length; i++) best = Math.min(best, segDistKm_(p, path[i - 1], path[i]));
      if (best > worst) { worst = best; at = p.t; }
    });
    out.offrouteKm = Math.round(worst * 10) / 10;
    out.offrouteAt = at ? fmtT(at) + ' น.' : '';
  }
  return out;
}

/** ระยะจากจุด p ถึงเส้นตรง a–b (กม.) */
function segDistKm_(p, a, b) {
  const k = Math.cos(p.lat * Math.PI / 180) * 111.32, K = 110.57;
  const ax = (a.lng - p.lng) * k, ay = (a.lat - p.lat) * K, bx = (b.lng - p.lng) * k, by = (b.lat - p.lat) * K;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const u = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
  return Math.hypot(ax + u * dx, ay + u * dy);
}

/** รถที่กำลังใช้อยู่ทั้งหมด พร้อมตำแหน่งล่าสุดและเส้นทาง (หน้าติดตามสด) */
function live_() {
  const trips = readTrips_().filter(t => t.status === 'open');
  const cache = CacheService.getScriptCache();
  let sheetPts = null;
  const out = trips.map(t => {
    let pts = null;
    try { pts = JSON.parse(cache.get('trk:' + t.id) || 'null'); } catch (e) {}
    if (!pts) { // แคชหาย อ่านจากชีตแทน
      sheetPts = sheetPts || trackSheet_().getDataRange().getValues().slice(1);
      pts = sheetPts.filter(r => String(r[0]) === t.id).map(r => [new Date(r[1]).getTime(), Number(r[2]), Number(r[3])]).sort((a, b) => a[0] - b[0]);
    }
    let stops = []; try { stops = JSON.parse(t.stopsJson || '[]'); } catch (e) {}
    const car = CONFIG.CARS.find(c => c.id === t.car) || {};
    return { id: t.id, car: t.car, carName: car.name, plate: car.plate, driver: t.driver, purpose: t.purpose,
      startTime: t.startTime, startOdo: t.startOdo, expectedKm: t.expectedKm, stops, points: pts };
  });
  return { trips: out, company: company_(), now: Date.now() };
}

// ---------- ที่ตั้งบริษัท ----------
function company_() {
  if (CONFIG.COMPANY_LAT != null && CONFIG.COMPANY_LNG != null) return { lat: Number(CONFIG.COMPANY_LAT), lng: Number(CONFIG.COMPANY_LNG), name: 'บริษัท' };
  const v = PropertiesService.getScriptProperties().getProperty('COMPANY');
  return v ? JSON.parse(v) : null;
}
function setCompany_(b) {
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!(lat > 5 && lat < 21 && lng > 97 && lng < 106)) throw new Error('ตำแหน่งนี้ไม่ได้อยู่ในประเทศไทย');
  const c = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, name: String(b.name || 'บริษัท').slice(0, 100) };
  PropertiesService.getScriptProperties().setProperty('COMPANY', JSON.stringify(c));
  return c;
}
