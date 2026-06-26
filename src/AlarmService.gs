/**
 * Alarm Statistics Service (ORC Line)
 *
 * Records HMI/machine alarm events (e.g. INCOMING AIR SUPPLY LOW, DOOR OPEN,
 * STATION 01 PUSHER JAM) and provides statistical aggregation: Pareto by alarm
 * type, breakdown by machine, downtime totals, and trend over time.
 */

var ALARM_LOG_HEADERS = ['AlarmID', 'Timestamp', 'Date', 'Shift', 'MachineID', 'AlarmType', 'Count', 'DurationMinutes', 'RecordedBy', 'RecorderName', 'Remark'];
var ALARM_TYPES_HEADERS = ['TypeID', 'TypeName', 'Active', 'CreatedAt', 'CreatedBy'];

// Common alarms taken from the ORC line HMI panels — used to seed the list.
var ALARM_TYPE_SEED = [
  'INCOMING AIR SUPPLY LOW',
  'DOOR OPEN',
  'STATION 01 PUSHER JAM',
  'EMERGENCY STOP',
  'OVERLOAD',
  'NO PART DETECTED'
];

function ensureAlarmSheets() {
  ensureSheetExists('AlarmLog', ALARM_LOG_HEADERS);
  var typesSheet = ensureSheetExists('AlarmTypes', ALARM_TYPES_HEADERS);
  if (typesSheet.getLastRow() <= 1) {
    var now = formatDate(new Date());
    var rows = ALARM_TYPE_SEED.map(function(name) {
      return ['AT-' + generateUUID().substring(0, 8).toUpperCase(), name, true, now, 'system'];
    });
    typesSheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

// === Alarm Types ===

function getAlarmTypes(token) {
  try {
    ensureAlarmSheets();
    var rows = getAllRows('AlarmTypes');
    return rows
      .filter(function(r) { return r.Active === '' || isActiveValue(r.Active); })
      .map(function(r) { return { typeId: r.TypeID, typeName: r.TypeName }; });
  } catch (e) {
    return [];
  }
}

function addAlarmType(token, typeName) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  typeName = String(typeName || '').trim();
  if (!typeName) return { success: false, message: 'กรุณากรอกชื่อ Alarm' };

  ensureAlarmSheets();
  var existing = findRows('AlarmTypes', function(r) {
    return String(r.TypeName).toUpperCase() === typeName.toUpperCase() && (r.Active === '' || isActiveValue(r.Active));
  });
  if (existing.length > 0) return { success: false, message: 'Alarm นี้มีอยู่แล้ว' };

  var typeId = 'AT-' + generateUUID().substring(0, 8).toUpperCase();
  appendRow('AlarmTypes', {
    TypeID: typeId,
    TypeName: typeName,
    Active: true,
    CreatedAt: formatDate(new Date()),
    CreatedBy: user.employeeId
  });

  return { success: true, typeId: typeId, message: 'เพิ่มชนิด Alarm สำเร็จ' };
}

function deleteAlarmType(token, typeId) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  ensureAlarmSheets();
  updateRow('AlarmTypes', 'TypeID', typeId, { Active: false });
  return { success: true, message: 'ลบชนิด Alarm สำเร็จ' };
}

// === Alarm Log ===

function submitAlarm(token, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  data = data || {};
  if (!data.alarmType) return { success: false, message: 'กรุณาเลือกชนิด Alarm' };
  if (!data.machineId) return { success: false, message: 'กรุณาเลือกเครื่องจักร' };

  var count = Number(data.count);
  if (!count || isNaN(count) || count < 1) count = 1;

  var duration = Number(data.durationMinutes);
  if (isNaN(duration) || duration < 0) duration = 0;

  ensureAlarmSheets();

  var now = data.recordedAt ? new Date(data.recordedAt) : new Date();
  var alarmId = 'AL-' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase();

  appendRow('AlarmLog', {
    AlarmID: alarmId,
    Timestamp: formatDate(now),
    Date: getWorkDate(now),
    Shift: detectShift(now),
    MachineID: data.machineId,
    AlarmType: data.alarmType,
    Count: count,
    DurationMinutes: duration,
    RecordedBy: user.employeeId,
    RecorderName: user.name,
    Remark: data.remark || ''
  });

  return { success: true, alarmId: alarmId, message: 'บันทึก Alarm เรียบร้อย: ' + alarmId };
}

/**
 * Batch insert multiple alarm rows (used by the OCR-extraction queue).
 * items: [{ machineId, alarmType, count, durationMinutes, recordedAt, remark }]
 */
function submitAlarmBatch(token, items) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  if (!items || !items.length) return { success: false, message: 'ไม่มีรายการให้บันทึก' };

  ensureAlarmSheets();

  var saved = 0;
  var failed = 0;
  var errors = [];

  items.forEach(function(data) {
    data = data || {};
    if (!data.alarmType || !data.machineId) {
      failed++;
      return;
    }
    try {
      var count = Number(data.count);
      if (!count || isNaN(count) || count < 1) count = 1;
      var duration = Number(data.durationMinutes);
      if (isNaN(duration) || duration < 0) duration = 0;

      var when = data.recordedAt ? new Date(data.recordedAt) : new Date();
      var alarmId = 'AL-' + Utilities.formatDate(when, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase();

      appendRow('AlarmLog', {
        AlarmID: alarmId,
        Timestamp: formatDate(when),
        Date: getWorkDate(when),
        Shift: detectShift(when),
        MachineID: data.machineId,
        AlarmType: data.alarmType,
        Count: count,
        DurationMinutes: duration,
        RecordedBy: user.employeeId,
        RecorderName: user.name,
        Remark: data.remark || ''
      });
      saved++;
    } catch (e) {
      failed++;
      errors.push(e.message);
    }
  });

  return {
    success: saved > 0,
    saved: saved,
    failed: failed,
    message: 'บันทึก ' + saved + ' รายการ' + (failed ? ' (ล้มเหลว ' + failed + ')' : '')
  };
}

function getTodayAlarms(token) {
  var user = validateSession(token);
  if (!user) return [];

  ensureAlarmSheets();
  var today = getWorkDate(new Date());
  var logs = findRows('AlarmLog', function(r) { return r.Date === today; });
  logs.sort(function(a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); });
  return logs;
}

function filterAlarmLogs(filters) {
  var logs = getAllRows('AlarmLog');
  if (filters) {
    if (filters.dateFrom && filters.dateTo) {
      logs = logs.filter(function(r) { return r.Date >= filters.dateFrom && r.Date <= filters.dateTo; });
    }
    if (filters.machineId) {
      logs = logs.filter(function(r) { return r.MachineID === filters.machineId; });
    }
    if (filters.alarmType) {
      logs = logs.filter(function(r) { return r.AlarmType === filters.alarmType; });
    }
    if (filters.shift) {
      logs = logs.filter(function(r) { return r.Shift === filters.shift; });
    }
  }
  return logs;
}

function getAlarmHistory(token, filters) {
  var user = validateSession(token);
  if (!user) return [];

  ensureAlarmSheets();
  var logs = filterAlarmLogs(filters);
  logs.sort(function(a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); });
  return logs;
}

/**
 * Statistical aggregation for the dashboard view.
 * Returns Pareto by alarm type, breakdown by machine, trend by date, and totals.
 */
function getAlarmStats(token, filters) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  ensureAlarmSheets();
  var logs = filterAlarmLogs(filters);

  var totalAlarms = 0;
  var totalDowntime = 0;
  var byType = {};
  var byMachine = {};
  var byDate = {};
  var byShift = { Day: { count: 0, downtime: 0 }, Night: { count: 0, downtime: 0 } };

  logs.forEach(function(r) {
    var c = Number(r.Count) || 1;
    var d = Number(r.DurationMinutes) || 0;
    totalAlarms += c;
    totalDowntime += d;

    var t = r.AlarmType || 'ไม่ระบุ';
    if (!byType[t]) byType[t] = { type: t, count: 0, downtime: 0 };
    byType[t].count += c;
    byType[t].downtime += d;

    var m = r.MachineID || 'ไม่ระบุ';
    if (!byMachine[m]) byMachine[m] = { machineId: m, count: 0, downtime: 0 };
    byMachine[m].count += c;
    byMachine[m].downtime += d;

    var dt = r.Date || 'ไม่ระบุ';
    if (!byDate[dt]) byDate[dt] = { date: dt, count: 0, downtime: 0 };
    byDate[dt].count += c;
    byDate[dt].downtime += d;

    var sh = (r.Shift === 'Night') ? 'Night' : 'Day';
    byShift[sh].count += c;
    byShift[sh].downtime += d;
  });

  function toSortedArray(obj, key) {
    return Object.keys(obj).map(function(k) { return obj[k]; })
      .sort(function(a, b) { return b[key] - a[key]; });
  }

  var byTypeArr = toSortedArray(byType, 'count').map(function(o) {
    o.pct = totalAlarms > 0 ? Math.round((o.count / totalAlarms) * 1000) / 10 : 0;
    return o;
  });

  var byDateArr = Object.keys(byDate).sort().map(function(k) { return byDate[k]; });

  return {
    success: true,
    totalAlarms: totalAlarms,
    totalDowntime: totalDowntime,
    totalEvents: logs.length,
    byType: byTypeArr,
    byMachine: toSortedArray(byMachine, 'count'),
    byDate: byDateArr,
    byShift: byShift
  };
}
