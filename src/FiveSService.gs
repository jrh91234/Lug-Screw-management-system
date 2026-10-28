/**
 * 5ส. — machine vacuum cleaning (ดูดฝุ่น)
 *
 * A fixed weekly roster (Mon–Sat): each crew (A/B) cleans one machine a day, and crew B
 * runs three machines behind crew A so the two never clean the same machine on the same
 * day and every machine is cleaned twice a week, three days apart. The operator closes a
 * job with a photo taken in the page (camera only, no file attach); a Leader then checks
 * the photo and confirms it, or sends it back to be redone.
 *
 * 5ส. หลังเลิกงาน — every crew also closes each work day (Mon–Sat) with three photos of its
 * work area (all three required, same camera-only rule), checked by the Leader the same way.
 *
 * When the Leader confirms a job they also score it out of 10; the scores add up to a
 * monthly evaluation of each crew and of each person who did the work.
 */

var FIVES_SCHEDULE_SHEET = 'FiveSSchedule';
var FIVES_SCHEDULE_HEADERS = ['Day', 'Shift', 'MachineID', 'Assignees', 'UpdatedAt', 'UpdatedBy'];
var FIVES_LOG_SHEET = 'FiveSLog';
var FIVES_LOG_HEADERS = ['EntryID', 'Timestamp', 'Date', 'Day', 'Shift', 'MachineID', 'Assignees',
  'DoneBy', 'DoneByName', 'Photo', 'Remark', 'Status',
  'ConfirmedBy', 'ConfirmedName', 'ConfirmedAt', 'RejectReason', 'ClientRequestID', 'Score'];
var FIVES_END_SHEET = 'FiveSEndLog';
var FIVES_END_HEADERS = ['EntryID', 'Timestamp', 'Date', 'Day', 'Shift',
  'DoneBy', 'DoneByName', 'Photos', 'Remark', 'Status',
  'ConfirmedBy', 'ConfirmedName', 'ConfirmedAt', 'RejectReason', 'ClientRequestID', 'Score'];
var FIVES_END_PHOTOS = 3;      // every end-of-day job needs exactly this many photos
var FIVES_END_PREFIX = '5SE-'; // EntryID prefix that tells end-of-day jobs from vacuum jobs
var FIVES_SCORE_MAX = 10;      // Leader's score for a confirmed job: whole number 0..10
var FIVES_DAYS = 6;            // Monday (1) .. Saturday (6); no roster on Sunday
var FIVES_SHIFT_OFFSET = 3;    // crew B cleans the machine crew A cleaned three days earlier

// The roster is per crew, not per person: whoever is on shift cleans the machine. The
// Assignees columns stay in the sheets only so sheets created before this keep lining up.

function canUseFiveS(user) {
  return !!(user && user.permissions && user.permissions.fives);
}

/** Who may confirm a job and edit the roster: supervisors and admins, plus the Leader
 *  given the fivesConfirm permission. */
function canConfirmFiveS(user) {
  return isDailyCheckSupervisor(user) || !!(user && user.permissions && user.permissions.fivesConfirm);
}

function ensureFiveSSheets() {
  ensureSheetExists(FIVES_SCHEDULE_SHEET, FIVES_SCHEDULE_HEADERS);
  ensureSheetExists(FIVES_LOG_SHEET, FIVES_LOG_HEADERS);
  ensureSheetExists(FIVES_END_SHEET, FIVES_END_HEADERS);
}

function fiveSSheetFor(entryId) {
  return String(entryId).indexOf(FIVES_END_PREFIX) === 0 ? FIVES_END_SHEET : FIVES_LOG_SHEET;
}

/** 1 = Monday .. 7 = Sunday for a yyyy-MM-dd work date. */
function fiveSDayOfWeek(dateStr) {
  // Noon in Bangkok is 05:00 UTC on the same calendar day.
  var dow = new Date(dateStr + 'T12:00:00+07:00').getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Monday of the week the date is in (Sunday belongs to the week before it). */
function fiveSWeekStart(dateStr) {
  var d = new Date(dateStr + 'T12:00:00+07:00');
  var dow = fiveSDayOfWeek(dateStr);
  return formatDateOnly(new Date(d.getTime() - (dow - 1) * 24 * 60 * 60 * 1000));
}

function fiveSAddDays(dateStr, n) {
  var d = new Date(dateStr + 'T12:00:00+07:00');
  return formatDateOnly(new Date(d.getTime() + n * 24 * 60 * 60 * 1000));
}

function fiveSInstalledMachines() {
  return getMachines().filter(function(m) { return m.installed; })
    .map(function(m) { return m.machineId; })
    .sort();
}

/** The rotation laid over the first six installed machines. */
function fiveSDefaultSchedule() {
  var ids = fiveSInstalledMachines().slice(0, FIVES_DAYS);
  var rows = [];
  for (var d = 0; d < FIVES_DAYS; d++) {
    rows.push({ day: d + 1, shift: 'A', machineId: ids.length ? ids[d % ids.length] : '' });
    rows.push({ day: d + 1, shift: 'B', machineId: ids.length ? ids[(d + FIVES_SHIFT_OFFSET) % ids.length] : '' });
  }
  return rows;
}

/** The saved roster; the sheet is filled with the default the first time it is read. */
function readFiveSSchedule() {
  ensureFiveSSheets();
  var saved = getAllRows(FIVES_SCHEDULE_SHEET).map(function(r) {
    return {
      day: Number(r.Day) || 0,
      shift: normalizeCheckShift(r.Shift),
      machineId: String(r.MachineID || '').trim()
    };
  }).filter(function(r) { return r.day >= 1 && r.day <= FIVES_DAYS && r.shift; });
  if (saved.length) return saved;

  var rows = fiveSDefaultSchedule();
  var stamp = formatDate(new Date());
  var sheet = getSheet(FIVES_SCHEDULE_SHEET);
  var values = rows.map(function(r) { return [r.day, r.shift, r.machineId, '', stamp, 'system']; });
  sheet.getRange(2, 1, values.length, FIVES_SCHEDULE_HEADERS.length).setValues(values);
  return rows;
}

function fiveSScheduleFor(schedule, day, shift) {
  return schedule.filter(function(r) { return r.day === day && r.shift === shift; })[0] || null;
}

function readFiveSLogRows(dateFrom, dateTo, sheetName) {
  ensureFiveSSheets();
  var cutoff = new Date(dateFrom + 'T00:00:00+07:00');
  return getRowsSince(sheetName || FIVES_LOG_SHEET, 'Timestamp', cutoff).filter(function(r) {
    return r.Date >= dateFrom && r.Date <= dateTo && String(r.Status || '') !== 'cancelled';
  });
}

/** The score on a row, or null while it has none (not confirmed yet, or confirmed before scoring). */
function fiveSScoreOf(r) {
  if (r.Score === '' || r.Score === null || r.Score === undefined) return null;
  var n = Number(r.Score);
  return isNaN(n) ? null : n;
}

/** A whole number 0..FIVES_SCORE_MAX from the page, or null when the value is not one. */
function fiveSValidScore(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  var n = Number(raw);
  if (isNaN(n) || n !== Math.floor(n) || n < 0 || n > FIVES_SCORE_MAX) return null;
  return n;
}

function mapFiveSRow(r) {
  return {
    kind: 'machine',
    entryId: r.EntryID,
    timestamp: r.Timestamp,
    date: r.Date,
    day: Number(r.Day) || 0,
    shift: r.Shift,
    machineId: r.MachineID,
    doneBy: r.DoneBy,
    doneByName: r.DoneByName || '',
    photo: r.Photo || '',
    remark: r.Remark || '',
    status: String(r.Status || 'done'),
    confirmedBy: r.ConfirmedBy || '',
    confirmedName: r.ConfirmedName || '',
    confirmedAt: r.ConfirmedAt || '',
    rejectReason: r.RejectReason || '',
    score: fiveSScoreOf(r)
  };
}

function mapFiveSEndRow(r) {
  var photos = String(r.Photos || '').split(/\s*,\s*/).filter(function(u) { return u; });
  return {
    kind: 'end',
    entryId: r.EntryID,
    timestamp: r.Timestamp,
    date: r.Date,
    day: Number(r.Day) || 0,
    shift: r.Shift,
    machineId: '',
    doneBy: r.DoneBy,
    doneByName: r.DoneByName || '',
    photos: photos,
    photo: photos[0] || '',
    remark: r.Remark || '',
    status: String(r.Status || 'done'),
    confirmedBy: r.ConfirmedBy || '',
    confirmedName: r.ConfirmedName || '',
    confirmedAt: r.ConfirmedAt || '',
    rejectReason: r.RejectReason || '',
    score: fiveSScoreOf(r)
  };
}

/**
 * The roster plus one week of jobs (Mon–Sat of the week holding `date`), and every job
 * still waiting for a Leader so nothing slips through when it was done in an earlier week.
 */
function getFiveSWeek(token, date) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canUseFiveS(user)) return { success: false, message: 'ไม่มีสิทธิ์ใช้งานเมนู 5ส.' };
  var today = getWorkDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) date = today;
  var weekStart = fiveSWeekStart(date);
  var weekEnd = fiveSAddDays(weekStart, FIVES_DAYS - 1);

  var schedule = readFiveSSchedule();
  // Waiting jobs are looked up over the last 31 days; older ones were long dealt with on paper.
  var pendingFrom = fiveSAddDays(today, -31);
  var from = weekStart < pendingFrom ? weekStart : pendingFrom;
  var to = weekEnd > today ? weekEnd : today;
  var rows = readFiveSLogRows(from, to).map(mapFiveSRow);
  var endRows = readFiveSLogRows(from, to, FIVES_END_SHEET).map(mapFiveSEndRow);
  var inWeek = function(e) { return e.date >= weekStart && e.date <= weekEnd; };
  var isToday = function(e) { return e.date === today; };
  var isPending = function(e) { return e.status === 'done'; };

  return {
    success: true,
    today: today,
    todayDay: fiveSDayOfWeek(today),
    weekStart: weekStart,
    weekEnd: weekEnd,
    schedule: schedule,
    machines: fiveSInstalledMachines(),
    entries: rows.filter(inWeek),
    todayEntries: rows.filter(isToday),
    endEntries: endRows.filter(inWeek),
    endToday: endRows.filter(isToday),
    endPhotos: FIVES_END_PHOTOS,
    pending: rows.filter(isPending).concat(endRows.filter(isPending)),
    canConfirm: canConfirmFiveS(user)
  };
}

/** Replace the roster. rows: [{ day, shift, machineId }] for all 12 cells. */
function saveFiveSSchedule(token, rows) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canConfirmFiveS(user)) return { success: false, message: 'เฉพาะ Leader/หัวหน้างาน เท่านั้นที่แก้ตารางเวรได้' };
  if (!Array.isArray(rows)) return { success: false, message: 'ข้อมูลตารางเวรไม่ถูกต้อง' };

  var machineIds = {};
  getMachines().forEach(function(m) { machineIds[String(m.machineId)] = true; });
  var cells = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    var day = Number(r.day);
    var shift = normalizeCheckShift(r.shift);
    var machineId = String(r.machineId || '').trim();
    if (!(day >= 1 && day <= FIVES_DAYS) || !shift) return { success: false, message: 'ข้อมูลตารางเวรไม่ถูกต้อง' };
    if (machineId && !machineIds[machineId]) return { success: false, message: 'ไม่พบเครื่อง ' + machineId };
    cells[day + '|' + shift] = { day: day, shift: shift, machineId: machineId };
  }
  for (var d = 1; d <= FIVES_DAYS; d++) {
    if (!cells[d + '|A'] || !cells[d + '|B']) return { success: false, message: 'ตารางเวรต้องครบทุกวัน ทั้งกะ A และ B' };
  }

  ensureFiveSSheets();
  var stamp = formatDate(new Date());
  var name = user.name || user.employeeId;
  var values = [];
  for (var dd = 1; dd <= FIVES_DAYS; dd++) {
    ['A', 'B'].forEach(function(s) {
      var c = cells[dd + '|' + s];
      values.push([c.day, c.shift, c.machineId, '', stamp, name]);
    });
  }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var sheet = getSheet(FIVES_SCHEDULE_SHEET);
    var last = sheet.getLastRow();
    if (last > 1) sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).clearContent();
    sheet.getRange(2, 1, values.length, FIVES_SCHEDULE_HEADERS.length).setValues(values);
  } finally {
    lock.releaseLock();
  }
  return { success: true, schedule: readFiveSSchedule(), message: 'บันทึกตารางเวรเรียบร้อย' };
}

/**
 * Close today's job with the after-cleaning photo. data: { shift, machineId, photo, remark,
 * clientRequestId }. Only the current work day can be recorded, since the photo has to be
 * taken there and then. A job sent back by the Leader is redone on the same row.
 */
function submitFiveS(token, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canUseFiveS(user)) return { success: false, message: 'ไม่มีสิทธิ์ใช้งานเมนู 5ส.' };
  data = data || {};

  var clientRequestId = String(data.clientRequestId || '').trim();
  ensureFiveSSheets();
  if (clientRequestId) {
    var replay = findRow(FIVES_LOG_SHEET, 'ClientRequestID', clientRequestId);
    if (replay) return { success: true, entry: mapFiveSRow(replay), duplicate: true, message: 'บันทึกเรียบร้อย' };
  }

  var today = getWorkDate(new Date());
  var day = fiveSDayOfWeek(today);
  if (day > FIVES_DAYS) return { success: false, message: 'วันอาทิตย์ไม่มีเวรดูดฝุ่น' };
  var shift = normalizeCheckShift(data.shift);
  if (!shift) return { success: false, message: 'กรุณาเลือกกะ (A/B)' };
  var machineId = String(data.machineId || '').trim();
  var slot = fiveSScheduleFor(readFiveSSchedule(), day, shift);
  if (!slot || !slot.machineId) return { success: false, message: 'วันนี้กะ ' + shift + ' ยังไม่ได้กำหนดเครื่องในตารางเวร' };
  if (machineId !== slot.machineId) return { success: false, message: 'ตารางเวรเปลี่ยนแล้ว วันนี้กะ ' + shift + ' ต้องทำเครื่อง ' + slot.machineId + ' (กรุณาโหลดใหม่)' };

  var photo = data.photo;
  if (!photo || typeof photo !== 'string' || photo.indexOf('data:image/') !== 0) {
    return { success: false, message: 'กรุณาถ่ายรูปหลังทำความสะอาด' };
  }
  var remark = String(data.remark || '').trim().substring(0, 300);

  var existing = readFiveSLogRows(today, today).filter(function(r) {
    return String(r.Shift) === shift && String(r.MachineID) === machineId;
  })[0];
  if (existing && String(existing.Status) !== 'rejected') {
    return { success: false, message: 'เครื่อง ' + machineId + ' กะ ' + shift + ' บันทึกไปแล้วโดย ' + (existing.DoneByName || existing.DoneBy) };
  }

  var now = new Date();
  var entryId = existing ? String(existing.EntryID)
    : '5S-' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase();
  var photoUrl = savePhotoToDrive(photo, entryId + '_' + Utilities.formatDate(now, 'Asia/Bangkok', 'HHmmss') + '.jpg', '5S');
  if (!photoUrl) return { success: false, message: 'บันทึกรูปไม่สำเร็จ กรุณาลองใหม่' };

  if (existing) {
    updateRow(FIVES_LOG_SHEET, 'EntryID', entryId, {
      Timestamp: formatDate(now),
      DoneBy: user.employeeId,
      DoneByName: user.name,
      Photo: photoUrl,
      Remark: remark,
      Status: 'done',
      ConfirmedBy: '',
      ConfirmedName: '',
      ConfirmedAt: '',
      Score: '',
      ClientRequestID: clientRequestId
    });
  } else {
    appendRow(FIVES_LOG_SHEET, {
      EntryID: entryId,
      Timestamp: formatDate(now),
      Date: today,
      Day: day,
      Shift: shift,
      MachineID: machineId,
      DoneBy: user.employeeId,
      DoneByName: user.name,
      Photo: photoUrl,
      Remark: remark,
      Status: 'done',
      ClientRequestID: clientRequestId
    });
  }
  var saved = findRow(FIVES_LOG_SHEET, 'EntryID', entryId);
  return { success: true, entry: saved ? mapFiveSRow(saved) : null, message: 'บันทึกเรียบร้อย รอ Leader ตรวจยืนยัน' };
}

/**
 * Close the crew's work day with the end-of-day 5ส. photos. data: { shift, photos: [3 data
 * URLs], remark, clientRequestId }. All photos are required and only today can be recorded.
 * One job per crew per work day; one sent back by the Leader is redone on the same row.
 */
function submitFiveSEnd(token, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canUseFiveS(user)) return { success: false, message: 'ไม่มีสิทธิ์ใช้งานเมนู 5ส.' };
  data = data || {};

  var clientRequestId = String(data.clientRequestId || '').trim();
  ensureFiveSSheets();
  if (clientRequestId) {
    var replay = findRow(FIVES_END_SHEET, 'ClientRequestID', clientRequestId);
    if (replay) return { success: true, entry: mapFiveSEndRow(replay), duplicate: true, message: 'บันทึกเรียบร้อย' };
  }

  var shift = normalizeCheckShift(data.shift);
  if (!shift) return { success: false, message: 'กรุณาเลือกกะ (A/B)' };
  var photos = Array.isArray(data.photos) ? data.photos : [];
  var valid = photos.filter(function(p) { return typeof p === 'string' && p.indexOf('data:image/') === 0; });
  if (photos.length !== FIVES_END_PHOTOS || valid.length !== FIVES_END_PHOTOS) {
    return { success: false, message: 'กรุณาถ่ายรูปให้ครบ ' + FIVES_END_PHOTOS + ' รูป' };
  }
  var remark = String(data.remark || '').trim().substring(0, 300);

  var today = getWorkDate(new Date());
  if (fiveSDayOfWeek(today) > FIVES_DAYS) return { success: false, message: 'วันอาทิตย์ไม่มีเวร 5ส.' };
  var existing = readFiveSLogRows(today, today, FIVES_END_SHEET).filter(function(r) {
    return String(r.Shift) === shift;
  })[0];
  if (existing && String(existing.Status) !== 'rejected') {
    return { success: false, message: '5ส. หลังเลิกงาน กะ ' + shift + ' วันนี้บันทึกไปแล้วโดย ' + (existing.DoneByName || existing.DoneBy) };
  }

  var now = new Date();
  var entryId = existing ? String(existing.EntryID)
    : FIVES_END_PREFIX + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase();
  var hhmmss = Utilities.formatDate(now, 'Asia/Bangkok', 'HHmmss');
  var urls = [];
  for (var i = 0; i < photos.length; i++) {
    var url = savePhotoToDrive(photos[i], entryId + '_' + hhmmss + '_' + (i + 1) + '.jpg', '5S');
    if (!url) return { success: false, message: 'บันทึกรูปที่ ' + (i + 1) + ' ไม่สำเร็จ กรุณาลองใหม่' };
    urls.push(url);
  }

  if (existing) {
    updateRow(FIVES_END_SHEET, 'EntryID', entryId, {
      Timestamp: formatDate(now),
      DoneBy: user.employeeId,
      DoneByName: user.name,
      Photos: urls.join(', '),
      Remark: remark,
      Status: 'done',
      ConfirmedBy: '',
      ConfirmedName: '',
      ConfirmedAt: '',
      Score: '',
      ClientRequestID: clientRequestId
    });
  } else {
    appendRow(FIVES_END_SHEET, {
      EntryID: entryId,
      Timestamp: formatDate(now),
      Date: today,
      Day: fiveSDayOfWeek(today),
      Shift: shift,
      DoneBy: user.employeeId,
      DoneByName: user.name,
      Photos: urls.join(', '),
      Remark: remark,
      Status: 'done',
      ClientRequestID: clientRequestId
    });
  }
  var saved = findRow(FIVES_END_SHEET, 'EntryID', entryId);
  return { success: true, entry: saved ? mapFiveSEndRow(saved) : null, message: 'บันทึกเรียบร้อย รอ Leader ตรวจยืนยัน' };
}

/**
 * Leader sign-off for one or many jobs, each with its score. scores: { entryId: 0..10 }.
 * Every id needs a score; jobs not waiting for a check are left as they are.
 */
function confirmFiveS(token, entryIds, scores) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canConfirmFiveS(user)) return { success: false, message: 'เฉพาะ Leader/หัวหน้างาน เท่านั้นที่ยืนยันได้' };
  if (!Array.isArray(entryIds) || !entryIds.length) return { success: false, message: 'ไม่ได้เลือกรายการ' };
  if (entryIds.length > 500) return { success: false, message: 'ยืนยันได้ครั้งละไม่เกิน 500 รายการ' };
  scores = scores || {};
  var wanted = {};
  for (var i = 0; i < entryIds.length; i++) {
    var id0 = String(entryIds[i]);
    var score = fiveSValidScore(scores[id0]);
    if (score === null) {
      return { success: false, message: 'กรุณาให้คะแนน 0–' + FIVES_SCORE_MAX + ' ทุกรายการก่อนยืนยัน (ถ้าเพิ่งอัปเดตระบบ กรุณาโหลดหน้าใหม่)' };
    }
    wanted[id0] = score;
  }
  ensureFiveSSheets();
  var name = user.name || user.employeeId;
  var stamp = formatDate(new Date());
  var ids = [];
  var count = 0;
  [FIVES_LOG_SHEET, FIVES_END_SHEET].forEach(function(sheetName) {
    var updates = {};
    getAllRows(sheetName).forEach(function(r) {
      var id = String(r.EntryID);
      if (!wanted.hasOwnProperty(id) || fiveSSheetFor(id) !== sheetName || String(r.Status || '') !== 'done') return;
      updates[id] = { Status: 'confirmed', ConfirmedBy: user.employeeId, ConfirmedName: name, ConfirmedAt: stamp, RejectReason: '', Score: wanted[id] };
    });
    var sheetIds = Object.keys(updates);
    if (!sheetIds.length) return;
    // Sheets made before scoring have no Score column yet; add it before writing.
    ensureColumnExists(sheetName, 'Score');
    count += updateRows(sheetName, 'EntryID', updates);
    ids = ids.concat(sheetIds);
  });
  return { success: true, confirmed: count, confirmedIds: ids, confirmedName: name, confirmedAt: stamp,
    message: count ? 'ยืนยันเรียบร้อย ' + count + ' รายการ' : 'ไม่มีรายการที่รอยืนยัน' };
}

/**
 * Score jobs that are already confirmed: ones confirmed before scoring existed, or a
 * score the Leader wants to change. scores: { entryId: 0..10 }. Other jobs are skipped.
 */
function scoreFiveS(token, scores) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canConfirmFiveS(user)) return { success: false, message: 'เฉพาะ Leader/หัวหน้างาน เท่านั้นที่ให้คะแนนได้' };
  var ids = Object.keys(scores || {});
  if (!ids.length) return { success: false, message: 'ไม่ได้เลือกรายการ' };
  if (ids.length > 500) return { success: false, message: 'ให้คะแนนได้ครั้งละไม่เกิน 500 รายการ' };
  var wanted = {};
  for (var i = 0; i < ids.length; i++) {
    var score = fiveSValidScore(scores[ids[i]]);
    if (score === null) return { success: false, message: 'คะแนนต้องเป็นเลข 0–' + FIVES_SCORE_MAX };
    wanted[ids[i]] = score;
  }
  ensureFiveSSheets();
  var count = 0;
  [FIVES_LOG_SHEET, FIVES_END_SHEET].forEach(function(sheetName) {
    var updates = {};
    getAllRows(sheetName).forEach(function(r) {
      var id = String(r.EntryID);
      if (!wanted.hasOwnProperty(id) || fiveSSheetFor(id) !== sheetName || String(r.Status || '') !== 'confirmed') return;
      updates[id] = { Score: wanted[id] };
    });
    if (!Object.keys(updates).length) return;
    ensureColumnExists(sheetName, 'Score');
    count += updateRows(sheetName, 'EntryID', updates);
  });
  return { success: true, scored: count,
    message: count ? 'บันทึกคะแนนเรียบร้อย ' + count + ' รายการ' : 'ไม่มีรายการที่ยืนยันแล้วให้บันทึกคะแนน' };
}

/** Leader sends a job back: the crew has to clean again and take new photos. */
function rejectFiveS(token, entryId, reason) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canConfirmFiveS(user)) return { success: false, message: 'เฉพาะ Leader/หัวหน้างาน เท่านั้นที่ตีกลับได้' };
  reason = String(reason || '').trim().substring(0, 300);
  if (!reason) return { success: false, message: 'กรุณาระบุเหตุผลที่ให้ทำใหม่' };
  ensureFiveSSheets();
  var sheetName = fiveSSheetFor(entryId);
  var row = findRow(sheetName, 'EntryID', entryId);
  if (!row) return { success: false, message: 'ไม่พบรายการ' };
  if (String(row.Status) !== 'done') return { success: false, message: 'รายการนี้ไม่ได้รอยืนยันแล้ว' };
  updateRow(sheetName, 'EntryID', entryId, {
    Status: 'rejected',
    ConfirmedBy: user.employeeId,
    ConfirmedName: user.name || user.employeeId,
    ConfirmedAt: formatDate(new Date()),
    RejectReason: reason,
    Score: ''
  });
  return { success: true, message: 'ตีกลับให้ทำใหม่เรียบร้อย' };
}

/**
 * Every job of one month (yyyy-MM) up to today, for the Leader's scoring summary: the
 * page works out per-crew and per-person averages and how many jobs were missed.
 */
function getFiveSScores(token, month) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canConfirmFiveS(user)) return { success: false, message: 'เฉพาะ Leader/หัวหน้างาน เท่านั้นที่ดูคะแนนได้' };
  var today = getWorkDate(new Date());
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) month = today.substring(0, 7);
  var from = month + '-01';
  var p = month.split('-');
  var last = new Date(Date.UTC(Number(p[0]), Number(p[1]), 0)).getUTCDate();
  var to = month + '-' + (last < 10 ? '0' : '') + last;
  if (to > today) to = today;
  if (from > today) {
    return { success: true, month: month, from: from, to: to, today: today, schedule: readFiveSSchedule(), entries: [], endEntries: [] };
  }
  return {
    success: true, month: month, from: from, to: to, today: today,
    schedule: readFiveSSchedule(),
    entries: readFiveSLogRows(from, to).map(mapFiveSRow),
    endEntries: readFiveSLogRows(from, to, FIVES_END_SHEET).map(mapFiveSEndRow)
  };
}
