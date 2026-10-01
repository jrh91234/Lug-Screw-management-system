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
    updateRow(DAILY_CHECK_SHEET, 'CheckID', existing.CheckID, {
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

  var checkId = 'DC-' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase();
  appendRow(DAILY_CHECK_SHEET, {
    CheckID: checkId,
    Timestamp: formatDate(now),
    Date: workDate,
    Shift: user.shift || '',
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

/** All checks for one work date (every machine), used to colour the slot grid and draw the sheet. */
function getDailyChecks(token, date) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  var workDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : getWorkDate(new Date());
  var rows = readDailyCheckRows(workDate, workDate).map(mapDailyCheckRow);
  return { success: true, date: workDate, items: DAILY_CHECK_ITEMS, checks: rows };
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
  checks.forEach(function(r) {
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
    byDate: Object.keys(byDate).sort().map(function(k) { return byDate[k]; }),
    rejects: rejects.slice(0, 50),
    missing: missing.slice(0, 100)
  };
}
