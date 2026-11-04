/**
 * Daily Check Machine — the machine's own daily AM check, one entry per machine per shift.
 *
 * Replaces the Google Form "AM : B-TSU09 — Lug & Screw". The question titles and answer
 * texts below are copied character for character from that form (typos and AM numbers
 * included), so the records read the same as the form operators already know. Same list
 * as MC_ITEMS on docs/pages/dailycheck.html.
 *
 * kind 'choice': okText is the form's "in good condition" answer, ngText the failed one.
 * kind 'scale':  the form's linear scale (scaleMin..scaleMax, with its end labels); a
 *                reading outside the spec in the title [specMin, specMax] is abnormal.
 */

var MACHINE_CHECK_SHEET = 'MachineCheckLog';
var MACHINE_CHECK_LINE = 'S/A.. LugScrew';
var MACHINE_CHECK_HEADERS = ['EntryID', 'Timestamp', 'Date', 'ShiftDN', 'Shift', 'Line', 'MachineID',
  'Q1', 'Q2', 'Q3', 'Q4', 'Abnormal', 'Result', 'InspectorID', 'InspectorName', 'Status',
  'ClientRequestID', 'UpdatedAt', 'UpdatedBy'];

var MACHINE_CHECK_ITEMS = [
  { key: 'Q1', kind: 'choice', title: '1. ตรวจเช็คปุ่มกดหยุดฉุกเฉิน(Emergency Stop) (AM2)',
    okText: 'อยู่ในสภาพสมบรูณ์ พร้อมใช้งานและต้องคลายออก',
    ngText: 'ชำรุด แตกหัก ไม่สามารถคลายออกได้' },
  { key: 'Q2', kind: 'choice', title: '2. ครวจเช็คสภาพ Photo Sensor (AM3)',
    okText: 'อยู่ในสภาพสมบรูณ์ หน้าเลนส์ต้องสะอาด ไม่มีฝุ่น',
    ngText: 'ชำรุด แตกหัก' },
  { key: 'Q3', kind: 'scale', title: '3. ตรวจเช็คระบบลม สเปค 5-7 bar/ 0.5-0.7 Mpa (AM1)',
    scaleMin: 0, scaleMax: 8, minLabel: '0 bar หรือ ลมรั่ว', maxLabel: 'มากกว่า 8  bar / 0.8 Mpa', specMin: 5, specMax: 7 },
  { key: 'Q4', kind: 'scale', title: '4. ตรวจเช็คระบบลม สเปค1 -3bar/ 0.1-0.3 Mpa (AM1)',
    scaleMin: 1, scaleMax: 3, minLabel: '1bar', maxLabel: 'มากกว่า3bar', specMin: 1, specMax: 3 }
];

function ensureMachineCheckSheet() {
  return ensureSheetExists(MACHINE_CHECK_SHEET, MACHINE_CHECK_HEADERS);
}

/** 'Day' / 'Night', or '' for anything else. */
function normalizeMachineCheckShiftDN(val) {
  var s = String(val || '').trim().toLowerCase();
  return s === 'day' ? 'Day' : s === 'night' ? 'Night' : '';
}

/** Bangkok start of a shift on a work date: Day 08:00, Night 20:00. */
function machineCheckShiftStart(workDate, shiftDN) {
  return new Date(workDate + 'T' + (shiftDN === 'Night' ? '20' : '08') + ':00:00+07:00');
}

/** Rows whose work date falls in [dateFrom, dateTo]; an entry is never stamped before
 *  its own work day starts, so the log is read back only to dateFrom 00:00. */
function readMachineCheckRows(dateFrom, dateTo) {
  ensureMachineCheckSheet();
  var cutoff = new Date(dateFrom + 'T00:00:00+07:00');
  return getRowsSince(MACHINE_CHECK_SHEET, 'Timestamp', cutoff).filter(function(r) {
    return r.Date >= dateFrom && r.Date <= dateTo && String(r.Status || '') !== 'cancelled';
  });
}

function mapMachineCheckRow(r) {
  var items = {};
  MACHINE_CHECK_ITEMS.forEach(function(it) { items[it.key] = r[it.key] === '' || r[it.key] == null ? '' : String(r[it.key]); });
  return {
    entryId: r.EntryID,
    timestamp: r.Timestamp,
    date: r.Date,
    shiftDN: r.ShiftDN,
    shift: r.Shift,
    line: r.Line,
    machineId: r.MachineID,
    items: items,
    abnormal: r.Abnormal,
    result: r.Result,
    inspectorId: r.InspectorID,
    inspectorName: r.InspectorName,
    updatedAt: r.UpdatedAt,
    updatedBy: r.UpdatedBy
  };
}

/**
 * Validates one item answer. Choice items accept 'OK' / 'NG' (or the form's answer texts)
 * and store the form's answer text; scale items store the point picked on the scale.
 * Returns { value, ok } or null when the answer is missing or malformed.
 */
function normalizeMachineCheckAnswer(def, val) {
  if (def.kind === 'scale') {
    var s = String(val == null ? '' : val).trim();
    if (!/^\d{1,2}$/.test(s)) return null;
    var n = Number(s);
    if (n < def.scaleMin || n > def.scaleMax) return null;
    return { value: String(n), ok: n >= def.specMin && n <= def.specMax };
  }
  var v = String(val || '').trim();
  if (v === 'OK' || v === def.okText) return { value: def.okText, ok: true };
  if (v === 'NG' || v === def.ngText) return { value: def.ngText, ok: false };
  return null;
}

/**
 * Record (or correct) a machine's check for one shift. One entry per machine per work date
 * per shift (Day 08:00–19:59 / Night 20:00–07:59): saving again overwrites it, but only for
 * the inspector who recorded it or a supervisor/admin.
 */
function submitMachineCheck(token, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canUseDailyCheck(user)) return { success: false, message: 'ไม่มีสิทธิ์บันทึก Daily Check Machine' };

  data = data || {};
  var machineId = String(data.machineId || '').trim();
  if (!machineId) return { success: false, message: 'กรุณาเลือกเครื่องจักร (Select Machine)' };
  var shiftDN = normalizeMachineCheckShiftDN(data.shiftDN);
  if (!shiftDN) return { success: false, message: 'กรุณาเลือกกะ (เช้า/ดึก)' };

  var answers = {};
  var allOk = true;
  for (var i = 0; i < MACHINE_CHECK_ITEMS.length; i++) {
    var def = MACHINE_CHECK_ITEMS[i];
    var a = normalizeMachineCheckAnswer(def, data.items && data.items[def.key]);
    if (!a) {
      return { success: false, message: 'กรุณาตอบให้ครบทุกข้อ (ข้อ ' + (i + 1) + ')' };
    }
    answers[def.key] = a.value;
    if (!a.ok) allOk = false;
  }

  // Any abnormal item fails the check; with every item fine the inspector may still fail
  // it for something else found on the machine (written in the abnormal note).
  var result = allOk && String(data.result || 'PASS').toUpperCase() !== 'FAIL' ? 'PASS' : 'FAIL';
  var abnormal = String(data.abnormal || '').trim().substring(0, 500);
  if (result === 'FAIL' && !abnormal) {
    return { success: false, message: 'ผลการตรวจ FAIL: กรุณากรอกข้อ 5 สิ่งผิดปกติที่ตรวจพบ' };
  }

  var now = new Date();
  var today = getWorkDate(now);
  var workDate = String(data.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) workDate = today;
  if (workDate > today || machineCheckShiftStart(workDate, shiftDN).getTime() > now.getTime()) {
    return { success: false, message: 'ยังไม่ถึงกะนี้' };
  }

  var machine = findRow('Machines', 'MachineID', machineId);
  if (!machine) return { success: false, message: 'ไม่พบเครื่องจักร' };

  var rows = readMachineCheckRows(workDate, workDate);
  var clientRequestId = String(data.clientRequestId || '').trim();
  if (clientRequestId) {
    var replay = rows.filter(function(r) { return String(r.ClientRequestID || '') === clientRequestId; })[0];
    if (replay) return { success: true, entryId: replay.EntryID, duplicate: true, result: replay.Result, message: 'บันทึกไว้แล้ว' };
  }

  var existing = rows.filter(function(r) {
    return String(r.MachineID) === machineId && String(r.ShiftDN) === shiftDN;
  })[0];

  var fields = {
    Q1: answers.Q1, Q2: answers.Q2, Q3: answers.Q3, Q4: answers.Q4,
    Abnormal: abnormal,
    Result: result,
    ClientRequestID: clientRequestId
  };

  if (existing) {
    if (String(existing.InspectorID) !== String(user.employeeId) && !isDailyCheckSupervisor(user)) {
      return { success: false, message: 'กะนี้ ' + (existing.InspectorName || existing.InspectorID) + ' ตรวจแล้ว (แก้ไขได้เฉพาะผู้ตรวจหรือหัวหน้า)' };
    }
    fields.UpdatedAt = formatDate(now);
    fields.UpdatedBy = user.name || user.employeeId;
    updateRow(MACHINE_CHECK_SHEET, 'EntryID', existing.EntryID, fields);
    return { success: true, entryId: existing.EntryID, updated: true, result: result, message: 'แก้ไขผลตรวจเครื่องจักรเรียบร้อย' };
  }

  var entryId = 'MC-' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase();
  fields.EntryID = entryId;
  fields.Timestamp = formatDate(now);
  fields.Date = workDate;
  fields.ShiftDN = shiftDN;
  fields.Shift = normalizeCheckShift(user.shift);
  fields.Line = MACHINE_CHECK_LINE;
  fields.MachineID = machineId;
  fields.InspectorID = user.employeeId;
  fields.InspectorName = user.name;
  fields.Status = 'active';
  appendRow(MACHINE_CHECK_SHEET, fields);
  return { success: true, entryId: entryId, result: result, message: 'บันทึก Daily Check Machine เรียบร้อย' };
}

/** Supervisor/admin only: withdraw a wrong entry so the shift can be checked again. */
function cancelMachineCheck(token, entryId) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!isDailyCheckSupervisor(user)) return { success: false, message: 'ไม่มีสิทธิ์ลบรายการ' };
  ensureMachineCheckSheet();
  var ok = updateRow(MACHINE_CHECK_SHEET, 'EntryID', entryId, {
    Status: 'cancelled',
    UpdatedAt: formatDate(new Date()),
    UpdatedBy: user.name || user.employeeId
  });
  return ok ? { success: true, message: 'ลบรายการเรียบร้อย' } : { success: false, message: 'ไม่พบรายการ' };
}

/** The monthly check sheet: entries over a date range (at most 62 days), one machine or all. */
function getMachineCheckLog(token, machineId, dateFrom, dateTo) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  var today = getWorkDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateTo || ''))) dateTo = today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateFrom || ''))) dateFrom = dateTo;
  if (dateFrom > dateTo) { var t = dateFrom; dateFrom = dateTo; dateTo = t; }
  var earliest = formatDateOnly(new Date(new Date(dateTo + 'T12:00:00+07:00').getTime() - 62 * 24 * 60 * 60 * 1000));
  if (dateFrom < earliest) dateFrom = earliest;
  machineId = String(machineId || '').trim();
  var entries = readMachineCheckRows(dateFrom, dateTo).filter(function(r) {
    return !machineId || String(r.MachineID) === machineId;
  }).map(mapMachineCheckRow);
  entries.sort(function(a, b) {
    return (a.date + (a.shiftDN === 'Night' ? 'b' : 'a')).localeCompare(b.date + (b.shiftDN === 'Night' ? 'b' : 'a'));
  });
  return { success: true, machineId: machineId, dateFrom: dateFrom, dateTo: dateTo, entries: entries };
}
