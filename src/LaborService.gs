/**
 * Labor Cost Service — per-employee wages by position, rolled up into the
 * Cost P&L's DL/OT line items (see getLaborTotals + CostService.computeCostMatrix).
 */

function ensureLaborSheets() {
  var ss = getSpreadsheet();
  createSheetIfNotExists(ss, 'Positions', ['PositionID', 'PositionName', 'Category', 'Active', 'CreatedAt', 'CreatedBy']);
  createSheetIfNotExists(ss, 'LaborCost', ['EntryID', 'YearMonth', 'EmployeeName', 'PositionID', 'PositionName', 'Category', 'DL', 'OT', 'CreatedAt', 'CreatedBy']);
}

function normalizePositionCategory(category) {
  return category === 'supervisor' ? 'supervisor' : 'worker';
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

function submitLaborEntry(token, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canManageLabor(user)) return { success: false, message: 'ไม่มีสิทธิ์บันทึกค่าแรง' };
  ensureLaborSheets();

  var employeeName = String((data && data.employeeName) || '').trim();
  var positionId = String((data && data.positionId) || '').trim();
  var yearMonth = getCostMonthRange(data && data.yearMonth).yearMonth;
  var dl = Number(data && data.dl) || 0;
  var ot = Number(data && data.ot) || 0;

  if (!employeeName) return { success: false, message: 'กรุณากรอกชื่อพนักงาน' };
  var position = findRow('Positions', 'PositionID', positionId);
  if (!position) return { success: false, message: 'กรุณาเลือกตำแหน่ง' };
  if (dl < 0 || ot < 0) return { success: false, message: 'ค่าแรงต้องไม่ต่ำกว่าศูนย์' };
  if (dl === 0 && ot === 0) return { success: false, message: 'กรุณากรอกค่าแรงอย่างน้อยหนึ่งช่อง' };

  var entryId = 'LB-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMddHHmmss') + '-' + generateUUID().substring(0, 4).toUpperCase();
  appendRow('LaborCost', {
    EntryID: entryId,
    YearMonth: yearMonth,
    EmployeeName: employeeName,
    PositionID: position.PositionID,
    PositionName: position.PositionName,
    Category: position.Category,
    DL: dl,
    OT: ot,
    CreatedAt: formatDate(new Date()),
    CreatedBy: user.employeeId
  });
  return { success: true, entryId: entryId, message: 'บันทึกค่าแรงสำเร็จ' };
}

function deleteLaborEntry(token, entryId) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canManageLabor(user)) return { success: false, message: 'ไม่มีสิทธิ์ลบรายการค่าแรง' };
  ensureLaborSheets();

  deleteRow('LaborCost', 'EntryID', entryId);
  return { success: true, message: 'ลบรายการค่าแรงสำเร็จ' };
}

function getLaborCost(token, yearMonth) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canManageLabor(user)) return { success: false, message: 'ไม่มีสิทธิ์เข้าถึงข้อมูลค่าแรง' };
  ensureLaborSheets();

  var range = getCostMonthRange(yearMonth);
  var entries = findRows('LaborCost', function(r) { return String(r.YearMonth || '') === range.yearMonth; });
  return {
    success: true,
    yearMonth: range.yearMonth,
    entries: entries.map(function(r) {
      return {
        entryId: r.EntryID, employeeName: r.EmployeeName, positionId: r.PositionID,
        positionName: r.PositionName, category: r.Category, dl: Number(r.DL) || 0, ot: Number(r.OT) || 0
      };
    }),
    totals: getLaborTotalsFromRows(entries)
  };
}

// preloadedEntries lets callers that loop over many months (the cost dashboard)
// read LaborCost once instead of on every iteration.
function getLaborTotals(yearMonth, preloadedEntries) {
  var rows = (preloadedEntries || getAllRows('LaborCost')).filter(function(r) { return String(r.YearMonth || '') === yearMonth; });
  return getLaborTotalsFromRows(rows);
}

// Regular ("worker") positions roll into DL/OT; supervisor/mini-MD positions roll into DLSUP/OTSUP.
function getLaborTotalsFromRows(rows) {
  var totals = { dl: 0, dlsup: 0, ot: 0, otsup: 0 };
  rows.forEach(function(r) {
    var isSupervisor = String(r.Category || '') === 'supervisor';
    totals[isSupervisor ? 'dlsup' : 'dl'] += Number(r.DL) || 0;
    totals[isSupervisor ? 'otsup' : 'ot'] += Number(r.OT) || 0;
  });
  return totals;
}
