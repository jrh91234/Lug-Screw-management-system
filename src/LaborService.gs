/**
 * Labor Cost Service — employees are registered once (shift + daily/OT rates).
 * DL/OT costs are computed automatically every month from ProductionLog activity
 * (see getLaborTotals + CostService.computeCostMatrix), not entered by hand.
 *
 * Shift schedule (Asia/Bangkok):
 *   Day:   08:00-12:00, 13:00-17:00 normal; break 17:00-17:30; OT 17:30-20:00
 *   Night: 20:00-00:00, 01:00-05:00 normal; break 05:00-05:30; OT 05:30-08:00
 * ProductionLog only tracks whole-hour periods (e.g. "18:00-18:59"), so the hour
 * straddling each break (17:00-17:59 / 05:00-05:59) is excluded from the OT check
 * to avoid crediting OT off a log entry that actually belongs to the meal break.
 * If ANY production log lands in a shift's OT hours on a given work-date, every
 * employee registered to that shift is credited a full 2.5 hours of OT for that
 * date — not just whoever happened to submit the log.
 */

var SHIFT_OT_HOURS = { day: [18, 19], night: [6, 7] };
var SHIFT_OT_HOURS_PER_DAY = 2.5;

function ensureLaborSheets() {
  var ss = getSpreadsheet();
  createSheetIfNotExists(ss, 'Positions', ['PositionID', 'PositionName', 'Category', 'Active', 'CreatedAt', 'CreatedBy']);
  createSheetIfNotExists(ss, 'LaborEmployees', ['EmployeeID', 'EmployeeName', 'PositionID', 'PositionName', 'Category', 'Shift', 'DailyRate', 'OTHourlyRate', 'Active', 'CreatedAt', 'CreatedBy']);
}

function normalizePositionCategory(category) {
  return category === 'supervisor' ? 'supervisor' : 'worker';
}

function normalizeShift(shift) {
  return shift === 'night' ? 'night' : 'day';
}

// 'labor' is granted per individual account (see admin.html's user permission editor),
// unlike 'cost' which is granted to the whole admin/supervisor role — so this checks
// the user's actual merged permissions instead of their role.
function canManageLabor(user) {
  return !!(user && user.permissions && user.permissions.labor);
}

function getPositions(token) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  ensureLaborSheets();

  var rows = getAllRows('Positions').filter(function(r) { return isActiveValue(r.Active); });
  return {
    success: true,
    items: rows.map(function(r) {
      return { positionId: r.PositionID, positionName: r.PositionName, category: r.Category };
    })
  };
}

function addPosition(token, name, category) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canManageLabor(user)) return { success: false, message: 'ไม่มีสิทธิ์จัดการตำแหน่ง' };
  ensureLaborSheets();

  name = String(name || '').trim();
  if (!name) return { success: false, message: 'กรุณากรอกชื่อตำแหน่ง' };
  category = normalizePositionCategory(category);

  var existing = findRows('Positions', function(r) { return r.PositionName === name && isActiveValue(r.Active); });
  if (existing.length > 0) return { success: false, message: 'ตำแหน่งนี้มีอยู่แล้ว' };

  var positionId = 'POS-' + generateUUID().substring(0, 8).toUpperCase();
  appendRow('Positions', {
    PositionID: positionId,
    PositionName: name,
    Category: category,
    Active: true,
    CreatedAt: formatDate(new Date()),
    CreatedBy: user.employeeId
  });
  return { success: true, positionId: positionId, message: 'เพิ่มตำแหน่งสำเร็จ' };
}

function deletePosition(token, positionId) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canManageLabor(user)) return { success: false, message: 'ไม่มีสิทธิ์จัดการตำแหน่ง' };
  ensureLaborSheets();

  updateRow('Positions', 'PositionID', positionId, { Active: false });
  return { success: true, message: 'ลบตำแหน่งสำเร็จ' };
}

// Active system users, for the "add employee" picker — deliberately lighter than
// getAllUsers (which is admin-role-only and returns role/permissions data too).
function getActiveUsersForLabor(token) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canManageLabor(user)) return { success: false, message: 'ไม่มีสิทธิ์เข้าถึงข้อมูลพนักงาน' };

  var users = getAllRows('Users').filter(function(u) { return isActiveValue(u.Active); });
  return {
    success: true,
    items: users.map(function(u) { return { employeeId: u.EmployeeID, name: u.Name }; })
  };
}

function getLaborEmployees(token) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canManageLabor(user)) return { success: false, message: 'ไม่มีสิทธิ์เข้าถึงข้อมูลค่าแรง' };
  ensureLaborSheets();

  var rows = getAllRows('LaborEmployees').filter(function(r) { return isActiveValue(r.Active); });
  return {
    success: true,
    items: rows.map(function(r) {
      return {
        employeeId: r.EmployeeID, employeeName: r.EmployeeName, positionId: r.PositionID,
        positionName: r.PositionName, category: r.Category, shift: r.Shift,
        dailyRate: Number(r.DailyRate) || 0, otHourlyRate: Number(r.OTHourlyRate) || 0
      };
    })
  };
}

function addLaborEmployee(token, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canManageLabor(user)) return { success: false, message: 'ไม่มีสิทธิ์จัดการพนักงาน' };
  ensureLaborSheets();

  var employeeId = String((data && data.employeeId) || '').trim();
  var positionId = String((data && data.positionId) || '').trim();
  var shift = normalizeShift(data && data.shift);
  var dailyRate = Number(data && data.dailyRate) || 0;
  var otHourlyRate = Number(data && data.otHourlyRate) || 0;

  if (!employeeId) return { success: false, message: 'กรุณาเลือกพนักงาน' };
  var employee = findRow('Users', 'EmployeeID', employeeId);
  if (!employee) return { success: false, message: 'ไม่พบรหัสพนักงานนี้ในระบบ' };
  var position = findRow('Positions', 'PositionID', positionId);
  if (!position) return { success: false, message: 'กรุณาเลือกตำแหน่ง' };
  if (dailyRate < 0 || otHourlyRate < 0) return { success: false, message: 'อัตราค่าแรงต้องไม่ต่ำกว่าศูนย์' };

  var existing = findRows('LaborEmployees', function(r) { return r.EmployeeID === employeeId && isActiveValue(r.Active); });
  if (existing.length > 0) return { success: false, message: 'พนักงานนี้ถูกเพิ่มไว้แล้ว' };

  appendRow('LaborEmployees', {
    EmployeeID: employeeId,
    EmployeeName: employee.Name,
    PositionID: position.PositionID,
    PositionName: position.PositionName,
    Category: position.Category,
    Shift: shift,
    DailyRate: dailyRate,
    OTHourlyRate: otHourlyRate,
    Active: true,
    CreatedAt: formatDate(new Date()),
    CreatedBy: user.employeeId
  });
  return { success: true, message: 'เพิ่มพนักงานสำเร็จ' };
}

function updateLaborEmployee(token, employeeId, updates) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canManageLabor(user)) return { success: false, message: 'ไม่มีสิทธิ์จัดการพนักงาน' };
  ensureLaborSheets();

  employeeId = String(employeeId || '').trim();
  if (!employeeId) return { success: false, message: 'กรุณาระบุพนักงาน' };

  var patch = {};
  updates = updates || {};
  if (updates.positionId) {
    var position = findRow('Positions', 'PositionID', updates.positionId);
    if (!position) return { success: false, message: 'ไม่พบตำแหน่งนี้' };
    patch.PositionID = position.PositionID;
    patch.PositionName = position.PositionName;
    patch.Category = position.Category;
  }
  if (updates.shift) patch.Shift = normalizeShift(updates.shift);
  if (updates.dailyRate != null) {
    var dr = Number(updates.dailyRate);
    if (isNaN(dr) || dr < 0) return { success: false, message: 'อัตราค่าแรงรายวันไม่ถูกต้อง' };
    patch.DailyRate = dr;
  }
  if (updates.otHourlyRate != null) {
    var otr = Number(updates.otHourlyRate);
    if (isNaN(otr) || otr < 0) return { success: false, message: 'อัตราค่าแรง OT ไม่ถูกต้อง' };
    patch.OTHourlyRate = otr;
  }

  var found = updateRow('LaborEmployees', 'EmployeeID', employeeId, patch);
  if (!found) return { success: false, message: 'ไม่พบพนักงานนี้ในรายการ' };
  return { success: true, message: 'บันทึกข้อมูลพนักงานสำเร็จ' };
}

function deleteLaborEmployee(token, employeeId) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canManageLabor(user)) return { success: false, message: 'ไม่มีสิทธิ์จัดการพนักงาน' };
  ensureLaborSheets();

  updateRow('LaborEmployees', 'EmployeeID', employeeId, { Active: false });
  return { success: true, message: 'ลบพนักงานออกจากรายการสำเร็จ' };
}

// Which shifts had ANY production logged, and which had production logged
// specifically during the OT window, per work-date — shared across all employees
// of that shift regardless of who actually submitted each log entry.
function getShiftActivityByDate(productionLogs) {
  var worked = { day: {}, night: {} };
  var ot = { day: {}, night: {} };
  productionLogs.forEach(function(log) {
    var bucket = detectShiftBucketFromLog(log);
    if (bucket !== 'day' && bucket !== 'night') return;
    var date = String(log.Date || '');
    if (!date) return;
    worked[bucket][date] = true;

    var period = String(log.TimePeriod || '');
    var hour = period.indexOf(':') > 0 ? Number(period.split(':')[0]) : NaN;
    if (!isNaN(hour) && SHIFT_OT_HOURS[bucket].indexOf(hour) !== -1) {
      ot[bucket][date] = true;
    }
  });
  return { worked: worked, ot: ot };
}

// Per-employee DL/OT breakdown for a month, given that month's shift activity.
function computeEmployeeLabor(employees, activity) {
  return employees.map(function(emp) {
    var shift = normalizeShift(emp.Shift);
    var workedDays = Object.keys(activity.worked[shift]).length;
    var otDays = Object.keys(activity.ot[shift]).length;
    var dailyRate = Number(emp.DailyRate) || 0;
    var otHourlyRate = Number(emp.OTHourlyRate) || 0;
    var dl = workedDays * dailyRate;
    var ot = otDays * SHIFT_OT_HOURS_PER_DAY * otHourlyRate;
    return {
      employeeId: emp.EmployeeID, employeeName: emp.EmployeeName, positionName: emp.PositionName,
      category: emp.Category, shift: shift, workedDays: workedDays, dailyRate: dailyRate, dl: dl,
      otDays: otDays, otHourlyRate: otHourlyRate, ot: ot
    };
  });
}

// preloadedLogs/preloadedEmployees let callers that loop over many months (the cost
// dashboard) read ProductionLog/LaborEmployees once instead of on every iteration.
function getLaborTotals(yearMonth, preloadedLogs, preloadedEmployees) {
  var range = getCostMonthRange(yearMonth);
  var logs = (preloadedLogs || getAllRows('ProductionLog')).filter(function(log) {
    return log.Date >= range.from && log.Date <= range.to && String(log.Status || '').toLowerCase() !== 'cancelled';
  });
  var employees = (preloadedEmployees || getAllRows('LaborEmployees')).filter(function(r) { return isActiveValue(r.Active); });
  var activity = getShiftActivityByDate(logs);
  var rows = computeEmployeeLabor(employees, activity);

  var totals = { dl: 0, dlsup: 0, ot: 0, otsup: 0 };
  rows.forEach(function(r) {
    var isSupervisor = r.category === 'supervisor';
    totals[isSupervisor ? 'dlsup' : 'dl'] += r.dl;
    totals[isSupervisor ? 'otsup' : 'ot'] += r.ot;
  });
  return totals;
}

// Per-employee breakdown for display on the labor page (read-only — nothing here
// is entered by hand; it's derived straight from ProductionLog activity).
function getLaborMonthlyReport(token, yearMonth) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canManageLabor(user)) return { success: false, message: 'ไม่มีสิทธิ์เข้าถึงข้อมูลค่าแรง' };
  ensureLaborSheets();

  var range = getCostMonthRange(yearMonth);
  var logs = findRows('ProductionLog', function(log) {
    return log.Date >= range.from && log.Date <= range.to && String(log.Status || '').toLowerCase() !== 'cancelled';
  });
  var employees = getAllRows('LaborEmployees').filter(function(r) { return isActiveValue(r.Active); });
  var activity = getShiftActivityByDate(logs);
  var rows = computeEmployeeLabor(employees, activity);

  return { success: true, yearMonth: range.yearMonth, rows: rows };
}
