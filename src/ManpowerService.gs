/**
 * Manpower (เข้างาน / OT) for the dashboard PDF report.
 *
 * Reads the Attendance_JR tab of this app's own spreadsheet — a mirror of the
 * JR Organize "Attendance" tab fed by IMPORTRANGE (see APP_CONFIG.ATTENDANCE in
 * Config.gs). The JR Organize file itself is never opened from code.
 */

// Header text → comparable key: case and every kind of whitespace ignored.
function manpowerNormKey(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/\s+/g, '');
}

/**
 * WorkDate cell → 'yyyy-mm-dd' (or '' when it cannot be read).
 * Date objects are taken in Asia/Bangkok; text may be yyyy-mm-dd[...] or d/m/yyyy.
 */
function manpowerWorkDateKey(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return formatSheetDate(value).slice(0, 10);
  }
  var s = String(value == null ? '' : value).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

function getManpowerReport(token, dateRange) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }

  var cfg = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.ATTENDANCE) || {};
  var sheetName = cfg.SHEET || 'Attendance_JR';
  var subDepartment = cfg.SUB_DEPARTMENT || '';
  var result = {
    success: true,
    subDepartment: subDepartment,
    sheet: sheetName,
    missing: false,
    people: [],
    byDate: [],
    workCount: 0,
    otCount: 0
  };
  function missing(message) {
    result.missing = true;
    result.message = message;
    return result;
  }

  var range = resolveDashboardDateRange(dateRange);
  var filterByDate = !range.isAllTime;

  var sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return missing('ไม่พบแท็บ "' + sheetName + '" ในสเปรดชีตของระบบ');
  var values = sheet.getDataRange().getValues();
  if (!values.length) return missing('แท็บ "' + sheetName + '" ยังไม่มีข้อมูล (ตรวจสอบ IMPORTRANGE)');

  var col = {};
  values[0].forEach(function(header, i) {
    var key = manpowerNormKey(header);
    if (key && col[key] === undefined) col[key] = i;
  });
  var needed = ['workdate', 'username', 'name', 'type', 'subdepartment'];
  var lacking = needed.filter(function(k) { return col[k] === undefined; });
  if (lacking.length) {
    return missing('แท็บ "' + sheetName + '" ไม่มีคอลัมน์: ' + lacking.join(', '));
  }
  var posCol = col.position;
  var wantSub = manpowerNormKey(subDepartment);

  var seen = {};
  var peopleMap = {};
  var dateMap = {};
  var workPeople = {};
  var otPeople = {};

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (manpowerNormKey(row[col.subdepartment]) !== wantSub) continue;
    var type = manpowerNormKey(row[col.type]);
    if (type !== 'work' && type !== 'ot') continue;
    var date = manpowerWorkDateKey(row[col.workdate]);
    if (!date) continue;
    if (filterByDate && (date < range.dateFrom || date > range.dateTo)) continue;
    var name = String(row[col.name] == null ? '' : row[col.name]).trim();
    var id = String(row[col.username] == null ? '' : row[col.username]).trim();
    var personKey = id || ('name:' + name);
    if (!id && !name) continue;

    var dedupeKey = date + '|' + personKey + '|' + type;
    if (seen[dedupeKey]) continue;
    seen[dedupeKey] = true;

    var person = peopleMap[personKey];
    if (!person) {
      person = peopleMap[personKey] = { employeeId: id, name: name, position: '', workDays: 0, otDays: 0 };
    }
    if (!person.name && name) person.name = name;
    var position = posCol === undefined ? '' : String(row[posCol] == null ? '' : row[posCol]).trim();
    if (!person.position && position) person.position = position;

    var day = dateMap[date] || (dateMap[date] = { date: date, work: 0, ot: 0 });
    if (type === 'work') {
      person.workDays++;
      day.work++;
      workPeople[personKey] = true;
    } else {
      person.otDays++;
      day.ot++;
      otPeople[personKey] = true;
    }
  }

  result.people = Object.keys(peopleMap).map(function(k) { return peopleMap[k]; }).sort(function(a, b) {
    var la = /leader/i.test(a.position) ? 0 : 1;
    var lb = /leader/i.test(b.position) ? 0 : 1;
    if (la !== lb) return la - lb;
    var byName = String(a.name).localeCompare(String(b.name));
    if (byName) return byName;
    return String(a.employeeId).localeCompare(String(b.employeeId));
  });
  result.byDate = Object.keys(dateMap).sort().map(function(d) { return dateMap[d]; });
  result.workCount = Object.keys(workPeople).length;
  result.otCount = Object.keys(otPeople).length;
  return result;
}
