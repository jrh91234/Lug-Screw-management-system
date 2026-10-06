/**
 * Daily Check Service — DOMAE sub assy inspection record (M08 Terminal Lug and Screw)
 *
 * Replaces the paper Daily Check sheet: at the start of every working hour the operator
 * samples 4 pieces per machine and records the two check items below as pass / fail.
 * One row per machine per hourly slot per work date; the slot uses the same
 * "HH:00-HH:59" period as ProductionLog, so the paper column "9" is the 08:00-08:59 slot.
 */

var DAILY_CHECK_SHEET = 'DailyCheckLog';
var DAILY_CHECK_HEADERS = ['CheckID', 'Timestamp', 'Date', 'Shift', 'ShiftDN', 'TimePeriod', 'MachineID',
  'Item1', 'Item2', 'Decision', 'Remark', 'RecordedBy', 'RecorderName', 'Status', 'ClientRequestID',
  'UpdatedAt', 'UpdatedBy'];

var DAILY_CHECK_ITEMS = [
  { key: 'Item1', label: 'ตรวจสอบ เทอร์มินอลสกรูต้องอยู่ใน เทอร์มินอลลัก ไม่หลุดออก' },
  { key: 'Item2', label: 'หมุนเทอร์มินอลสกรูเข้าไปจนสุด และคลายสกรูกลับสู่ตำแหน่งที่ถูกต้อง' }
];

var DAILY_CHECK_PERIOD_RE = /^([01]\d|2[0-3]):00-([01]\d|2[0-3]):59$/;

function ensureDailyCheckSheet() {
  return ensureSheetExists(DAILY_CHECK_SHEET, DAILY_CHECK_HEADERS);
}

function canUseDailyCheck(user) {
  return !!(user && user.permissions && user.permissions.dailycheck);
}

function isDailyCheckSupervisor(user) {
  var rank = { admin: 4, supervisor: 3 };
  return !!(user && rank[String(user.role || '').toLowerCase()]);
}

/** Bangkok Date for the start of a slot: hours before 08:00 belong to the next calendar day. */
function dailyCheckSlotStart(workDate, timePeriod) {
  var hour = Number(String(timePeriod).substring(0, 2));
  var start = new Date(workDate + 'T' + String(timePeriod).substring(0, 2) + ':00:00+07:00');
  if (hour < 8) start = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return start;
}

function dailyCheckShiftDN(timePeriod) {
  var hour = Number(String(timePeriod).substring(0, 2));
  return (hour >= 8 && hour < 20) ? 'Day' : 'Night';
}

/** Rows whose work date falls in [dateFrom, dateTo]. A slot can only be recorded once it has
 *  started, so every row for dateFrom was stamped on or after that day's 08:00 — the log can
 *  be read from the bottom up to there instead of in full. */
function readDailyCheckRows(dateFrom, dateTo) {
  ensureDailyCheckSheet();
  var cutoff = new Date(dateFrom + 'T00:00:00+07:00');
  return getRowsSince(DAILY_CHECK_SHEET, 'Timestamp', cutoff).filter(function(r) {
    return r.Date >= dateFrom && r.Date <= dateTo && String(r.Status || '') !== 'cancelled';
  });
}

function mapDailyCheckRow(r) {
  return {
    checkId: r.CheckID,
    timestamp: r.Timestamp,
    date: r.Date,
    shift: r.Shift,
    shiftDN: r.ShiftDN,
    timePeriod: r.TimePeriod,
    machineId: r.MachineID,
    item1: r.Item1,
    item2: r.Item2,
    decision: r.Decision,
    remark: r.Remark,
    recordedBy: r.RecordedBy,
    recorderName: r.RecorderName,
    updatedAt: r.UpdatedAt,
    updatedBy: r.UpdatedBy
  };
}

/** 'A' / 'B', or '' for anything else. */
function normalizeCheckShift(val) {
  var s = String(val || '').trim().toUpperCase();
  return (s === 'A' || s === 'B') ? s : '';
}

function normalizeCheckResult(val) {
  var s = String(val || '').toUpperCase();
  return (s === 'OK' || s === 'NG') ? s : '';
}

/**
 * Record (or correct) one hourly check. A slot holds a single result per machine: saving
 * an already-recorded slot overwrites it, but only for the person who recorded it or a
 * supervisor/admin.
 */
function submitDailyCheck(token, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canUseDailyCheck(user)) return { success: false, message: 'ไม่มีสิทธิ์บันทึก Daily Check' };

  data = data || {};
  var machineId = String(data.machineId || '').trim();
  if (!machineId) return { success: false, message: 'กรุณาเลือกเครื่องจักร' };

  var timePeriod = String(data.timePeriod || '');
  var m = DAILY_CHECK_PERIOD_RE.exec(timePeriod);
  if (!m || m[1] !== m[2]) return { success: false, message: 'กรุณาเลือกช่วงเวลา' };

  var item1 = normalizeCheckResult(data.item1);
  var item2 = normalizeCheckResult(data.item2);
  if (!item1 || !item2) return { success: false, message: 'กรุณาตรวจให้ครบทั้ง 2 หัวข้อ' };

  var remark = String(data.remark || '').trim();
  var decision = (item1 === 'OK' && item2 === 'OK') ? 'Accept' : 'Reject';
  if (decision === 'Reject' && !remark) {
    return { success: false, message: 'กรุณากรอกหมายเหตุเมื่อผลเป็น Reject' };
  }

  var now = new Date();
  var workDate = String(data.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) workDate = getWorkDate(now);
  if (dailyCheckSlotStart(workDate, timePeriod).getTime() > now.getTime()) {
    return { success: false, message: 'ยังไม่ถึงช่วงเวลานี้' };
  }

  // Crew (A/B) comes from the user's profile when the admin has set one; people without
  // a shift on their profile (supervisors, relief staff) pick it on the form.
  var shift = normalizeCheckShift(user.shift) || normalizeCheckShift(data.shift);

  var machine = findRow('Machines', 'MachineID', machineId);
  if (!machine) return { success: false, message: 'ไม่พบเครื่องจักร' };

  var rows = readDailyCheckRows(workDate, workDate);

  // A replayed request (the GET tunnel can be retried by the browser or by a second
  // tap after a timeout) resolves to the row it already wrote.
  var clientRequestId = String(data.clientRequestId || '').trim();
  if (clientRequestId) {
    var replay = rows.filter(function(r) { return String(r.ClientRequestID || '') === clientRequestId; })[0];
    if (replay) return { success: true, checkId: replay.CheckID, duplicate: true, message: 'บันทึกไว้แล้ว' };
  }

  var existing = rows.filter(function(r) {
    return String(r.MachineID) === machineId && String(r.TimePeriod) === timePeriod;
  })[0];

  if (existing) {
    if (String(existing.RecordedBy) !== String(user.employeeId) && !isDailyCheckSupervisor(user)) {
      return { success: false, message: 'ช่วงเวลานี้ ' + (existing.RecorderName || existing.RecordedBy) + ' บันทึกแล้ว (แก้ไขได้เฉพาะผู้บันทึกหรือหัวหน้า)' };
    }
    // A correction keeps the crew of the original check (a supervisor fixing an operator's
    // entry must not move it to their own shift); it only fills it in when it was blank.
    var keptShift = normalizeCheckShift(existing.Shift) || shift;
    if (!keptShift) return { success: false, message: 'กรุณาเลือกกะ (A/B)' };
    updateRow(DAILY_CHECK_SHEET, 'CheckID', existing.CheckID, {
      Shift: keptShift,
      Item1: item1,
      Item2: item2,
      Decision: decision,
      Remark: remark,
      ClientRequestID: clientRequestId,
      UpdatedAt: formatDate(now),
      UpdatedBy: user.name || user.employeeId
    });
    return { success: true, checkId: existing.CheckID, updated: true, decision: decision, message: 'แก้ไขผลตรวจเรียบร้อย' };
  }

  if (!shift) return { success: false, message: 'กรุณาเลือกกะ (A/B)' };

  var checkId = 'DC-' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase();
  appendRow(DAILY_CHECK_SHEET, {
    CheckID: checkId,
    Timestamp: formatDate(now),
    Date: workDate,
    Shift: shift,
    ShiftDN: dailyCheckShiftDN(timePeriod),
    TimePeriod: timePeriod,
    MachineID: machineId,
    Item1: item1,
    Item2: item2,
    Decision: decision,
    Remark: remark,
    RecordedBy: user.employeeId,
    RecorderName: user.name,
    Status: 'active',
    ClientRequestID: clientRequestId
  });

  return { success: true, checkId: checkId, decision: decision, message: 'บันทึก Daily Check เรียบร้อย' };
}

/** Supervisor/admin only: withdraw a wrong entry so the slot can be recorded again. */
function cancelDailyCheck(token, checkId) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!isDailyCheckSupervisor(user)) return { success: false, message: 'ไม่มีสิทธิ์ลบรายการ' };
  ensureDailyCheckSheet();
  var ok = updateRow(DAILY_CHECK_SHEET, 'CheckID', checkId, {
    Status: 'cancelled',
    UpdatedAt: formatDate(new Date()),
    UpdatedBy: user.name || user.employeeId
  });
  return ok ? { success: true, message: 'ลบรายการเรียบร้อย' } : { success: false, message: 'ไม่พบรายการ' };
}

/**
 * All checks for one work date (every machine), used to colour the slot grid and draw the
 * sheet. The machine list rides along (from the cached master data) so opening the page is
 * a single round trip instead of two parallel ones.
 */
function getDailyChecks(token, date) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  var workDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : getWorkDate(new Date());
  var rows = readDailyCheckRows(workDate, workDate).map(mapDailyCheckRow);
  var ok1st = readOk1stRows(workDate, workDate).map(mapOk1stRow);
  var machines = [];
  try {
    var masters = getProductionMasterData();
    var machineProducts = masters.machineProducts || {};
    machines = (masters.machines || []).map(function(m) {
      return { machineId: m.machineId, machineName: m.machineName, status: m.status, installed: m.installed,
        currentProduct: m.currentProduct,
        products: (machineProducts[m.machineId] || []).map(function(p) { return { productCode: p.productCode, productName: p.productName }; }) };
    });
  } catch (e) {}
  return { success: true, date: workDate, items: DAILY_CHECK_ITEMS, checks: rows, machines: machines,
    ok1st: ok1st };
}

/**
 * Dashboard summary for a date range. A slot is "expected" when the machine logged
 * production in that hour — idle machines don't owe a check — so compliance is
 * checked production-hours / production-hours.
 */
function getDailyCheckSummary(token, dateFrom, dateTo) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  var today = getWorkDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateTo || ''))) dateTo = today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateFrom || ''))) dateFrom = dateTo;
  if (dateFrom > dateTo) { var t = dateFrom; dateFrom = dateTo; dateTo = t; }

  var checks = readDailyCheckRows(dateFrom, dateTo);
  var checked = {};
  checks.forEach(function(r) { checked[r.Date + '|' + r.MachineID + '|' + r.TimePeriod] = r; });

  var expected = {};
  var cutoff = new Date(dateFrom + 'T00:00:00+07:00');
  getRowsSince('ProductionLog', 'Timestamp', cutoff).forEach(function(r) {
    if (r.Date < dateFrom || r.Date > dateTo || String(r.Status || '') === 'cancelled') return;
    if (!DAILY_CHECK_PERIOD_RE.test(String(r.TimePeriod || ''))) return;
    expected[r.Date + '|' + r.MachineID + '|' + r.TimePeriod] = { date: r.Date, machineId: r.MachineID, timePeriod: r.TimePeriod };
  });

  var byMachine = {};
  function machineBucket(id) {
    if (!byMachine[id]) byMachine[id] = { machineId: id, checks: 0, accept: 0, reject: 0, expected: 0, missing: 0 };
    return byMachine[id];
  }

  var accept = 0, reject = 0;
  var rejects = [];
  var byShift = {};
  checks.forEach(function(r) {
    var shiftKey = normalizeCheckShift(r.Shift) || '-';
    if (!byShift[shiftKey]) byShift[shiftKey] = { shift: shiftKey, checks: 0, accept: 0, reject: 0 };
    byShift[shiftKey].checks++;
    byShift[shiftKey][r.Decision === 'Reject' ? 'reject' : 'accept']++;
    var b = machineBucket(r.MachineID);
    b.checks++;
    if (r.Decision === 'Reject') {
      b.reject++; reject++;
      rejects.push(mapDailyCheckRow(r));
    } else {
      b.accept++; accept++;
    }
  });

  var expectedCount = 0, coveredCount = 0;
  var missing = [];
  Object.keys(expected).forEach(function(key) {
    var e = expected[key];
    var b = machineBucket(e.machineId);
    b.expected++; expectedCount++;
    if (checked[key]) {
      coveredCount++;
    } else {
      b.missing++;
      missing.push(e);
    }
  });

  var byDate = {};
  checks.forEach(function(r) {
    if (!byDate[r.Date]) byDate[r.Date] = { date: r.Date, accept: 0, reject: 0, missing: 0 };
    byDate[r.Date][r.Decision === 'Reject' ? 'reject' : 'accept']++;
  });
  missing.forEach(function(e) {
    if (!byDate[e.date]) byDate[e.date] = { date: e.date, accept: 0, reject: 0, missing: 0 };
    byDate[e.date].missing++;
  });

  rejects.sort(function(a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)); });
  missing.sort(function(a, b) {
    return (b.date + b.timePeriod).localeCompare(a.date + a.timePeriod) || String(a.machineId).localeCompare(String(b.machineId));
  });

  return {
    success: true,
    dateFrom: dateFrom,
    dateTo: dateTo,
    totalChecks: checks.length,
    accept: accept,
    reject: reject,
    expected: expectedCount,
    covered: coveredCount,
    missingCount: missing.length,
    compliance: expectedCount > 0 ? Number(((coveredCount / expectedCount) * 100).toFixed(1)) : null,
    byMachine: Object.keys(byMachine).sort().map(function(k) { return byMachine[k]; }),
    byShift: Object.keys(byShift).sort().map(function(k) { return byShift[k]; }),
    byDate: Object.keys(byDate).sort().map(function(k) { return byDate[k]; }),
    rejects: rejects.slice(0, 50),
    missing: missing.slice(0, 100)
  };
}

/* ------------------------------------------------------------------------------------------
 * OK 1st Part Workstation Check list (THPLSTL-QA-FRM0-3434)
 *
 * Replaces the paper sheet filled before work starts on every shift and again on every
 * model change: one entry per machine per start, with the 10 workstation items, the
 * inspector, the supervisor's confirmation, and the last-piece check (*) which is filled in
 * when the run ends. A NOK item needs a recovery plan (problem / countermeasure), which is
 * the lower half of the paper form.
 * ------------------------------------------------------------------------------------------ */

var OK1ST_SHEET = 'Ok1stPartLog';
var OK1ST_ITEM_KEYS = ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'I10'];
// CheckAt holds the full date-time of the check: a bare "08:15" would be turned into a
// time-of-day value by Sheets and read back as a date in 1899.
var OK1ST_HEADERS = ['EntryID', 'Timestamp', 'Date', 'CheckAt', 'Shift', 'ShiftDN', 'MachineID', 'ProductCode',
  'Reason'].concat(OK1ST_ITEM_KEYS).concat(['LastPiece', 'Result', 'Problem', 'Countermeasure',
  'RecordedBy', 'RecorderName', 'ConfirmedBy', 'ConfirmedName', 'ConfirmedAt', 'Status', 'ClientRequestID',
  'UpdatedAt', 'UpdatedBy']);

// Same list as OK1_ITEMS on docs/pages/dailycheck.html. critical: marked * on the paper
// form (a NOK there means stop the line and switch to the red card). na: the item may be
// marked N/A. defaultNA: shaded on the Lug&Screw form (not used on this line).
var OK1ST_ITEMS = [
  { key: 'I1', no: '1*', critical: true, title: 'ความปลอดภัยส่วนบุคคล', detail: 'มี PPE ตามที่ระบุไว้ใน OWS? · PPE ชำรุด เสียหาย?', na: true },
  { key: 'I2', no: '2*', critical: true, title: 'ความปลอดภัยของเครื่องจักร', detail: 'ทำ AM checklist?', na: true },
  { key: 'I3', no: '3', critical: false, title: '5S at station', detail: 'ตรวจสอบ 5ส', na: true },
  { key: 'I4', no: '4', critical: false, title: 'กล่องเหลือง / แดง', detail: 'มีกล่องเหลือง/แดง ตามที่กำหนดไว้? · กล่องต้องไม่มีชิ้นงานก่อนเริ่มงาน', na: true },
  { key: 'I5', no: '5*', critical: true, title: 'OWS', detail: 'มี OWS อยู่ ณ จุดที่ทำงาน?', na: true },
  { key: 'I6', no: '6', critical: false, title: 'วัตถุดิบ / ชิ้นส่วน', detail: 'ชิ้นส่วนถูกต้อง ครบถ้วน? · มีการชี้บ่งหมายเลขชิ้นส่วนอย่างชัดเจน?', na: true },
  { key: 'I7', no: '7*', critical: true, title: 'เครื่องมือวัด', detail: 'เครื่องมือวัด/ทดสอบ มี sticker สอบเทียบ? · sticker สอบเทียบหมดอายุหรือไม่?', na: true },
  { key: 'I8', no: '8*', critical: true, title: 'ตัวอย่างงานเสีย', detail: 'ตัวอย่างงานเสียมีการชี้บ่งชัดเจน? · ตัวอย่างหมดอายุหรือไม่?', na: true, defaultNA: true },
  { key: 'I9', no: '9*', critical: true, title: 'PY-JD', detail: 'มีการทดสอบ PY-JD? · PY-JD สามารถใช้งานได้?', na: true, defaultNA: true },
  { key: 'I10', no: '10*', critical: true, title: 'ผลการตรวจชิ้นงานตัวแรก', detail: 'ชิ้นงานตัวแรกถูกต้อง ตรงตาม CTQ ที่กำหนดไว้?', na: false }
];

function ensureOk1stSheet() {
  return ensureSheetExists(OK1ST_SHEET, OK1ST_HEADERS);
}

/** 'OK' / 'NOK' / 'NA' (when allowed), or '' for anything else. */
function normalizeOk1stValue(val, allowNA) {
  var s = String(val || '').trim().toUpperCase().replace('/', '');
  if (s === 'OK') return 'OK';
  if (s === 'NOK' || s === 'NG') return 'NOK';
  if (allowNA && s === 'NA') return 'NA';
  return '';
}

/** Rows whose work date falls in [dateFrom, dateTo]. An entry is stamped no earlier than
 *  the start of its own work day, so the log only needs reading back to dateFrom 00:00. */
function readOk1stRows(dateFrom, dateTo) {
  ensureOk1stSheet();
  var cutoff = new Date(dateFrom + 'T00:00:00+07:00');
  return getRowsSince(OK1ST_SHEET, 'Timestamp', cutoff).filter(function(r) {
    return r.Date >= dateFrom && r.Date <= dateTo && String(r.Status || '') !== 'cancelled';
  });
}

function mapOk1stRow(r) {
  var items = {};
  OK1ST_ITEM_KEYS.forEach(function(k) { items[k] = r[k] || ''; });
  return {
    entryId: r.EntryID,
    timestamp: r.Timestamp,
    date: r.Date,
    checkTime: String(r.CheckAt || '').substring(11, 16) || '00:00',
    shift: r.Shift,
    shiftDN: r.ShiftDN,
    machineId: r.MachineID,
    productCode: r.ProductCode,
    reason: r.Reason,
    items: items,
    lastPiece: r.LastPiece || '',
    result: r.Result,
    problem: r.Problem,
    countermeasure: r.Countermeasure,
    recordedBy: r.RecordedBy,
    recorderName: r.RecorderName,
    confirmedBy: r.ConfirmedBy,
    confirmedName: r.ConfirmedName,
    confirmedAt: r.ConfirmedAt,
    updatedAt: r.UpdatedAt,
    updatedBy: r.UpdatedBy
  };
}

/** Bangkok Date of a check time on a work date; times before 08:00 are on the next calendar day. */
function ok1stCheckStart(workDate, checkTime) {
  var hour = Number(String(checkTime).substring(0, 2));
  var start = new Date(workDate + 'T' + checkTime + ':00+07:00');
  if (hour < 8) start = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return start;
}

/**
 * Record a new OK 1st Part check (data.entryId empty) or correct an existing one. Only the
 * person who recorded an entry or a supervisor/admin may change it. Changing the start
 * checks after the supervisor confirmed them withdraws the confirmation; filling in the
 * last piece later does not.
 */
function submitOk1stPart(token, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canUseDailyCheck(user)) return { success: false, message: 'ไม่มีสิทธิ์บันทึก OK 1st Part' };

  data = data || {};
  var machineId = String(data.machineId || '').trim();
  if (!machineId) return { success: false, message: 'กรุณาเลือกเครื่องจักร' };
  var productCode = String(data.productCode || '').trim();
  if (!productCode) return { success: false, message: 'กรุณาเลือก Product reference' };
  var reason = String(data.reason || '') === 'changeover' ? 'changeover' : 'start';

  var checkTime = String(data.checkTime || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(checkTime)) return { success: false, message: 'กรุณากรอกเวลาตรวจ (HH:mm)' };

  var items = {};
  for (var i = 0; i < OK1ST_ITEMS.length; i++) {
    var def = OK1ST_ITEMS[i];
    var v = normalizeOk1stValue(data.items && data.items[def.key], def.na);
    if (!v) return { success: false, message: 'กรุณาตรวจให้ครบทุกหัวข้อ (ข้อ ' + def.no + ')' };
    items[def.key] = v;
  }
  var lastPiece = normalizeOk1stValue(data.lastPiece, false);

  var hasNok = OK1ST_ITEM_KEYS.some(function(k) { return items[k] === 'NOK'; }) || lastPiece === 'NOK';
  var result = hasNok ? 'NOK' : 'OK';
  var problem = String(data.problem || '').trim();
  var countermeasure = String(data.countermeasure || '').trim();
  if (hasNok && (!problem || !countermeasure)) {
    return { success: false, message: 'ผล NOK: กรุณากรอกปัญหาและการแก้ไข (recovery plan)' };
  }

  var now = new Date();
  var today = getWorkDate(now);
  var workDate = String(data.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) workDate = today;
  if (workDate > today || ok1stCheckStart(workDate, checkTime).getTime() > now.getTime() + 5 * 60 * 1000) {
    return { success: false, message: 'ยังไม่ถึงเวลานี้' };
  }

  var shift = normalizeCheckShift(user.shift) || normalizeCheckShift(data.shift);
  var machine = findRow('Machines', 'MachineID', machineId);
  if (!machine) return { success: false, message: 'ไม่พบเครื่องจักร' };

  var rows = readOk1stRows(workDate, workDate);
  var clientRequestId = String(data.clientRequestId || '').trim();
  if (clientRequestId) {
    var replay = rows.filter(function(r) { return String(r.ClientRequestID || '') === clientRequestId; })[0];
    if (replay) return { success: true, entryId: replay.EntryID, duplicate: true, result: replay.Result, message: 'บันทึกไว้แล้ว' };
  }

  var entryId = String(data.entryId || '').trim();
  if (entryId) {
    var existing = rows.filter(function(r) { return String(r.EntryID) === entryId; })[0];
    if (!existing) return { success: false, message: 'ไม่พบรายการ (อาจถูกลบไปแล้ว)' };
    if (String(existing.RecordedBy) !== String(user.employeeId) && !isDailyCheckSupervisor(user)) {
      return { success: false, message: 'รายการนี้ ' + (existing.RecorderName || existing.RecordedBy) + ' บันทึก (แก้ไขได้เฉพาะผู้บันทึกหรือหัวหน้า)' };
    }
    var keptShift = normalizeCheckShift(existing.Shift) || shift;
    if (!keptShift) return { success: false, message: 'กรุณาเลือกกะ (A/B)' };

    var checkAt = formatDate(ok1stCheckStart(workDate, checkTime));
    var startChanged = String(existing.ProductCode) !== productCode || ok1stFullStamp(existing.CheckAt) !== checkAt ||
      OK1ST_ITEM_KEYS.some(function(k) { return String(existing[k] || '') !== items[k]; });
    var updates = {
      Shift: keptShift,
      CheckAt: checkAt,
      ShiftDN: dailyCheckShiftDN(checkTime.substring(0, 2) + ':00-' + checkTime.substring(0, 2) + ':59'),
      ProductCode: productCode,
      Reason: reason,
      LastPiece: lastPiece,
      Result: result,
      Problem: problem,
      Countermeasure: countermeasure,
      ClientRequestID: clientRequestId,
      UpdatedAt: formatDate(now),
      UpdatedBy: user.name || user.employeeId
    };
    OK1ST_ITEM_KEYS.forEach(function(k) { updates[k] = items[k]; });
    var unconfirmed = false;
    if (startChanged && existing.ConfirmedBy) {
      updates.ConfirmedBy = '';
      updates.ConfirmedName = '';
      updates.ConfirmedAt = '';
      unconfirmed = true;
    }
    updateRow(OK1ST_SHEET, 'EntryID', existing.EntryID, updates);
    return { success: true, entryId: existing.EntryID, updated: true, result: result, unconfirmed: unconfirmed,
      message: unconfirmed ? 'แก้ไขเรียบร้อย (ต้องให้หัวหน้ายืนยันใหม่)' : 'แก้ไขเรียบร้อย' };
  }

  if (!shift) return { success: false, message: 'กรุณาเลือกกะ (A/B)' };

  var newId = 'OK1-' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase();
  var row = {
    EntryID: newId,
    Timestamp: formatDate(now),
    Date: workDate,
    CheckAt: formatDate(ok1stCheckStart(workDate, checkTime)),
    Shift: shift,
    ShiftDN: dailyCheckShiftDN(checkTime.substring(0, 2) + ':00-' + checkTime.substring(0, 2) + ':59'),
    MachineID: machineId,
    ProductCode: productCode,
    Reason: reason,
    LastPiece: lastPiece,
    Result: result,
    Problem: problem,
    Countermeasure: countermeasure,
    RecordedBy: user.employeeId,
    RecorderName: user.name,
    Status: 'active',
    ClientRequestID: clientRequestId
  };
  OK1ST_ITEM_KEYS.forEach(function(k) { row[k] = items[k]; });
  appendRow(OK1ST_SHEET, row);
  return { success: true, entryId: newId, result: result, message: 'บันทึก OK 1st Part เรียบร้อย' };
}

/** Supervisor/admin sign-off (the "หัวหน้างานยืนยัน" column). */
function confirmOk1stPart(token, entryId) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!isDailyCheckSupervisor(user)) return { success: false, message: 'เฉพาะหัวหน้างานเท่านั้นที่ยืนยันได้' };
  ensureOk1stSheet();
  var now = new Date();
  var ok = updateRow(OK1ST_SHEET, 'EntryID', entryId, {
    ConfirmedBy: user.employeeId,
    ConfirmedName: user.name || user.employeeId,
    ConfirmedAt: formatDate(now)
  });
  return ok ? { success: true, confirmedName: user.name || user.employeeId, confirmedAt: formatDate(now), message: 'ยืนยันเรียบร้อย' }
    : { success: false, message: 'ไม่พบรายการ' };
}

/** Supervisor/admin only: withdraw a wrong entry. */
function cancelOk1stPart(token, entryId) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!isDailyCheckSupervisor(user)) return { success: false, message: 'ไม่มีสิทธิ์ลบรายการ' };
  ensureOk1stSheet();
  var ok = updateRow(OK1ST_SHEET, 'EntryID', entryId, {
    Status: 'cancelled',
    UpdatedAt: formatDate(new Date()),
    UpdatedBy: user.name || user.employeeId
  });
  return ok ? { success: true, message: 'ลบรายการเรียบร้อย' } : { success: false, message: 'ไม่พบรายการ' };
}

/** The paper-sheet view: one machine's entries over a date range (at most 62 days). */
function getOk1stPartLog(token, machineId, dateFrom, dateTo) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  var today = getWorkDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateTo || ''))) dateTo = today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateFrom || ''))) dateFrom = dateTo;
  if (dateFrom > dateTo) { var t = dateFrom; dateFrom = dateTo; dateTo = t; }
  var earliest = formatDateOnly(new Date(new Date(dateTo + 'T12:00:00+07:00').getTime() - 62 * 24 * 60 * 60 * 1000));
  if (dateFrom < earliest) dateFrom = earliest;
  machineId = String(machineId || '').trim();
  var entries = readOk1stRows(dateFrom, dateTo).filter(function(r) {
    return !machineId || String(r.MachineID) === machineId;
  }).map(mapOk1stRow);
  entries.sort(function(a, b) {
    return (a.date + ' ' + ok1stSortTime(a.checkTime)).localeCompare(b.date + ' ' + ok1stSortTime(b.checkTime));
  });
  return { success: true, machineId: machineId, dateFrom: dateFrom, dateTo: dateTo, entries: entries };
}

/** A sheet date-time read back at exactly midnight comes without its time part. */
function ok1stFullStamp(val) {
  var s = String(val || '');
  return s.length === 10 ? s + ' 00:00:00' : s;
}

/** Orders check times within a work day: 08:00 first, 07:59 last. */
function ok1stSortTime(t) {
  var h = Number(String(t).substring(0, 2));
  return (h < 8 ? 'b' : 'a') + String(t);
}
