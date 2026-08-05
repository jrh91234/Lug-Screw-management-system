/**
 * Production Log Service
 * Handles production entry, history, and summaries
 */

// How far back a submission is checked for having already been recorded. A retry —
// whether the operator's or the browser's — follows the original by seconds; the id
// window is generous enough to also cover a phone that only gets back online much
// later, without ever scanning the whole log.
var PRODUCTION_DUPLICATE_ID_WINDOW_MS = 24 * 60 * 60 * 1000;
var PRODUCTION_DUPLICATE_CONTENT_WINDOW_MS = 2 * 60 * 1000;

/**
 * Newest row in `rows` matching `matchFn`, ignoring anything older than `cutoffMs`
 * (the tail read overshoots by up to a chunk). Scans an already-loaded window rather
 * than calling findRow(), which would read the entire sheet on every save.
 */
function findLatestProductionMatch(rows, cutoffMs, matchFn) {
  for (var i = rows.length - 1; i >= 0; i--) {
    if (cutoffMs) {
      var ts = parseSheetDateTime(rows[i].Timestamp);
      if (!ts || ts.getTime() < cutoffMs) continue;
    }
    if (matchFn(rows[i])) return rows[i];
  }
  return null;
}

function submitProduction(token, data) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }

  if (!data.machineId || !data.productCode) {
    return { success: false, message: 'กรุณาเลือกเครื่องจักรและผลิตภัณฑ์' };
  }

  ensureColumnExists('ProductionLog', 'DefectDetails');
  ensureColumnExists('ProductionLog', 'ClientRequestID');

  var defectByComponent = data.defectByComponent || {};
  var defectTotal = 0;
  for (var compCode in defectByComponent) {
    if (!defectByComponent.hasOwnProperty(compCode)) continue;
    var q = Number(defectByComponent[compCode].qty) || 0;
    if (q < 0) {
      return { success: false, message: 'จำนวนของเสียไม่ถูกต้อง' };
    }
    if (q > defectTotal) defectTotal = q;
  }

  var actualQty = Number(data.actualQty);
  if (isNaN(actualQty)) {
    return { success: false, message: 'จำนวนผลิตไม่ถูกต้อง' };
  }

  var submittedDefectQty = Number(data.defectQty);
  if (isNaN(submittedDefectQty)) submittedDefectQty = 0;
  if (submittedDefectQty < 0) {
    return { success: false, message: 'จำนวนของเสียไม่ถูกต้อง' };
  }
  var finalDefectQty = defectTotal > 0 ? defectTotal : submittedDefectQty;
  if (finalDefectQty > 0 && actualQty >= 0) {
    actualQty = 0;
  }

  var now = new Date();
  var logId = generateUUID();
  var workDate = data.workDate ? String(data.workDate) : getWorkDate(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    workDate = getWorkDate(now);
  }
  var timePeriod = data.timePeriod || detectTimePeriod(now);

  // Idempotency guard. Submissions go out as GET requests (the Apps Script CORS
  // workaround), which browsers and mobile proxies consider safe to retry on their
  // own, and an operator on a slow connection will press the button again when the
  // response never arrives — while the row was in fact already written. Both produce
  // the same duplicate, so the client sends a stable id per attempted entry and we
  // return the row it already created instead of writing a second one.
  var recentRows = getRowsSince('ProductionLog', 'Timestamp',
    new Date(now.getTime() - PRODUCTION_DUPLICATE_ID_WINDOW_MS));

  var clientRequestId = String(data.clientRequestId || '').trim();
  if (clientRequestId) {
    var existing = findLatestProductionMatch(recentRows, 0, function(row) {
      return String(row.ClientRequestID || '') === clientRequestId;
    });
    if (existing) {
      return {
        success: true,
        logId: existing.LogID,
        duplicate: true,
        message: 'รายการนี้ถูกบันทึกไว้แล้ว (ไม่บันทึกซ้ำ)'
      };
    }
  }

  // Fallback for clients that don't send an id yet (a phone still running a cached
  // copy of the old page): an identical entry for the same slot from the same person
  // within a couple of minutes is a retry, not a second batch.
  var sameEntry = findLatestProductionMatch(recentRows, now.getTime() - PRODUCTION_DUPLICATE_CONTENT_WINDOW_MS, function(row) {
    return String(row.EmployeeID || '') === String(user.employeeId || '') &&
           String(row.MachineID || '') === String(data.machineId || '') &&
           String(row.ProductCode || '') === String(data.productCode || '') &&
           String(row.Date || '') === workDate &&
           String(row.TimePeriod || '') === String(timePeriod) &&
           Number(row.ActualQty) === actualQty &&
           Number(row.DefectQty) === finalDefectQty &&
           String(row.Status || '') !== 'cancelled';
  });
  if (sameEntry) {
    return {
      success: true,
      logId: sameEntry.LogID,
      duplicate: true,
      message: 'รายการนี้ถูกบันทึกไว้แล้ว (ไม่บันทึกซ้ำ)'
    };
  }

  // Use shift from user profile (set by admin)
  var shift = user.shift || '';

  appendRow('ProductionLog', {
    LogID: logId,
    Timestamp: formatDate(now),
    Date: workDate,
    Shift: shift,
    TimePeriod: timePeriod,
    EmployeeID: user.employeeId,
    EmployeeName: user.name,
    MachineID: data.machineId,
    ProductCode: data.productCode,
    PlannedQty: data.plannedQty || 1300,
    ActualQty: actualQty,
    DefectQty: finalDefectQty,
    DefectDetails: Object.keys(defectByComponent).length > 0 ? JSON.stringify(defectByComponent) : '',
    Remark: data.remark || '',
    Status: 'completed',
    ClientRequestID: clientRequestId
  });

  writeActionLog(user.employeeId, user.name, 'submit_production', {
    machineId: data.machineId,
    productCode: data.productCode,
    actualQty: actualQty,
    defectQty: finalDefectQty
  });

  return { success: true, logId: logId, message: 'บันทึกยอดผลิตเรียบร้อย' };
}

// A row's work date can differ from the day it was actually appended (entries before
// 08:00 belong to the previous work day, and operators may correct a date by hand), so
// when we bound the sheet read by timestamp we start a couple of days earlier than the
// requested date range. Well outside any legitimate skew, still bounded.
var PRODUCTION_LOG_WINDOW_GRACE_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Earliest timestamp we need to read for a given filter set, or null when the filters
 * don't bound the range (then the full sheet is read, as before).
 */
function productionLogReadCutoff(filters) {
  if (!filters) return null;
  var from = filters.date || filters.dateFrom;
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(String(from))) return null;
  var start = new Date(String(from) + 'T00:00:00');
  if (isNaN(start.getTime())) return null;
  return new Date(start.getTime() - PRODUCTION_LOG_WINDOW_GRACE_MS);
}

function getProductionHistory(token, filters) {
  var user = validateSession(token);
  if (!user) return [];
  return queryProductionLogs(user, filters);
}

/**
 * Same as getProductionHistory but for callers that already validated the session —
 * revalidating means a second full scan of the Users sheet on every request.
 * `sinceTimestamp` lets a caller that filters by age (rather than by work date) bound
 * the sheet read to the tail it actually needs.
 */
function queryProductionLogs(user, filters, sinceTimestamp) {
  if (!user) return [];

  var cutoff = sinceTimestamp || productionLogReadCutoff(filters);
  var logs = cutoff
    ? getRowsSince('ProductionLog', 'Timestamp', cutoff)
    : getAllRows('ProductionLog');

  if (filters) {
    if (filters.date) {
      logs = logs.filter(function(log) {
        return log.Date === filters.date;
      });
    }
    if (filters.dateFrom && filters.dateTo) {
      logs = logs.filter(function(log) {
        return log.Date >= filters.dateFrom && log.Date <= filters.dateTo;
      });
    }
    if (filters.machineId) {
      logs = logs.filter(function(log) {
        return log.MachineID === filters.machineId;
      });
    }
    if (filters.employeeId) {
      logs = logs.filter(function(log) {
        return log.EmployeeID === filters.employeeId;
      });
    }
    if (filters.productCode) {
      logs = logs.filter(function(log) {
        return log.ProductCode === filters.productCode;
      });
    }
    if (filters.shift) {
      logs = logs.filter(function(log) {
        return log.Shift === filters.shift;
      });
    }
    if (filters.status) {
      logs = logs.filter(function(log) {
        return log.Status === filters.status;
      });
    }
  }

  // Sort by timestamp descending
  logs.sort(function(a, b) {
    return new Date(b.Timestamp) - new Date(a.Timestamp);
  });

  if (filters && filters.limit) {
    logs = logs.slice(0, filters.limit);
  }

  return logs;
}

function getTodayProductionByEmployee(token) {
  var user = validateSession(token);
  if (!user) return [];

  var today = getWorkDate(new Date());
  return queryProductionLogs(user, {
    date: today,
    employeeId: user.employeeId,
    limit: 10
  });
}

function getRecentProductionByEmployee(token, days) {
  var user = validateSession(token);
  if (!user) return [];

  var lookbackDays = Number(days) || 2;
  if (lookbackDays < 1) lookbackDays = 1;
  if (lookbackDays > 7) lookbackDays = 7;

  var now = new Date();
  var cutoff = new Date(now.getTime() - (lookbackDays * 24 * 60 * 60 * 1000));
  var logs = queryProductionLogs(user, { employeeId: user.employeeId }, cutoff);

  return logs.filter(function(log) {
    var ts = new Date(log.Timestamp);
    if (isNaN(ts.getTime())) return false;
    return ts >= cutoff;
  }).map(function(log) {
    var canEdit = canEditProductionLog(user, log, now);
    log.CanEdit = canEdit;
    return log;
  });
}

function getEditableProductionEntries(token, filters) {
  return buildEditableProductionEntries(validateSession(token), filters);
}

function buildEditableProductionEntries(user, filters) {
  if (!user) return [];

  filters = filters || {};
  var logs = [];

  if (user.role === 'admin') {
    logs = queryProductionLogs(user, filters);
  } else {
    // Non-admins only ever see their own last 2 days, so read just that tail.
    var cutoff = new Date(new Date().getTime() - (2 * 24 * 60 * 60 * 1000));
    logs = queryProductionLogs(user, { employeeId: user.employeeId }, cutoff);
    logs = logs.filter(function(log) {
      var ts = new Date(log.Timestamp);
      if (isNaN(ts.getTime())) return false;
      return ts >= cutoff;
    });
  }

  var nowForEdit = new Date();
  return logs.map(function(log) {
    log.CanEdit = canEditProductionLog(user, log, nowForEdit);
    return log;
  });
}

/**
 * Machines, the products assigned to each, and every product's BOM.
 *
 * The page used to make three round trips before an operator could type a number:
 * machines on load, the machine's products on tap, then that product's BOM. These
 * tables are a handful of rows each and change only when an admin edits them, so they
 * are assembled once, cached, and shipped together — machine and product selection
 * then need no request at all.
 */
function getProductionMasterData() {
  var cached = getCachedMasterData();
  if (cached) return cached;

  var machineRows = getAllRows('Machines');
  var productRows = getAllRows('Products');

  var machineProducts = {};
  machineRows.forEach(function(row) {
    machineProducts[row.MachineID] = buildMachineProductList(row, productRows);
  });

  var bom = {};
  getAllRows('BOM').forEach(function(row) {
    var code = row.ProductCode;
    if (!code) return;
    if (!bom[code]) bom[code] = [];
    bom[code].push({
      productCode: row.ProductCode,
      componentCode: row.ComponentCode,
      componentName: row.ComponentName,
      qtyPerUnit: row.QtyPerUnit,
      supplier: row.Supplier
    });
  });

  var masters = {
    machines: machineRows.map(mapMachineRow),
    machineProducts: machineProducts,
    bom: bom
  };
  putCachedMasterData(masters);
  return masters;
}

/**
 * Page bootstrap for the production form.
 *
 * `include: 'masters'` returns the master tables only. That matters: the machine grid
 * is the first thing an operator touches and the master tables load in a fraction of
 * the time the entry-list query takes, so bundling the two made the grid wait for the
 * slower half. The current page asks for masters here and fetches the entry list in
 * parallel; a phone still serving a cached copy of the previous page sends no
 * `include` and keeps getting both in one response.
 */
function getProductionFormData(token, filters, options) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  var masters = getProductionMasterData();
  var result = {
    success: true,
    machines: masters.machines,
    machineProducts: masters.machineProducts,
    bom: masters.bom
  };
  if (!options || options.include !== 'masters') {
    result.entries = buildEditableProductionEntries(user, filters);
  }
  return result;
}

function cancelProduction(token, logId) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }

  var log = findRow('ProductionLog', 'LogID', logId);
  if (!log) {
    return { success: false, message: 'ไม่พบรายการ' };
  }

  // Only allow cancellation by the creator or supervisor/admin
  if (log.EmployeeID !== user.employeeId && !hasRole(token, 'supervisor')) {
    return { success: false, message: 'ไม่มีสิทธิ์ยกเลิกรายการนี้' };
  }

  updateRow('ProductionLog', 'LogID', logId, { Status: 'cancelled' });
  return { success: true, message: 'ยกเลิกรายการเรียบร้อย' };
}

function requestDeleteProduction(token, logId, reason) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  var deleteReason = String(reason || '').trim();
  if (!deleteReason) return { success: false, message: 'กรุณากรอกเหตุผลการลบ' };

  var log = findRow('ProductionLog', 'LogID', logId);
  if (!log) return { success: false, message: 'ไม่พบรายการ' };
  if (log.Status === 'cancelled') return { success: false, message: 'รายการนี้ถูกยกเลิกแล้ว' };
  if (!canEditProductionLog(user, log, new Date())) {
    return { success: false, message: 'ไม่มีสิทธิ์ลบรายการนี้' };
  }

  // Direct delete flow: no supervisor/admin approval required
  updateRow('ProductionLog', 'LogID', logId, { Status: 'cancelled' });

  writeActionLog(user.employeeId, user.name, 'delete_production_entry', {
    logId: logId,
    reason: deleteReason
  });

  return { success: true, message: 'ลบยอดผลิตเรียบร้อย' };
}

function approveDeleteProductionRequest(token, requestId, approve, note) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!(user.role === 'admin' || user.role === 'supervisor')) {
    return { success: false, message: 'ไม่มีสิทธิ์อนุมัติคำขอ' };
  }

  ensureAuxiliarySheetsForWorkflow();
  var req = findRow('ProductionDeleteRequests', 'RequestID', requestId);
  if (!req) return { success: false, message: 'ไม่พบคำขอ' };
  if (req.Status !== 'pending') return { success: false, message: 'คำขอนี้ถูกดำเนินการแล้ว' };

  var status = approve ? 'approved' : 'rejected';
  updateRow('ProductionDeleteRequests', 'RequestID', requestId, {
    Status: status,
    ReviewedBy: user.employeeId,
    ReviewedAt: formatDate(new Date()),
    ReviewNote: note || ''
  });

  if (approve) {
    updateRow('ProductionLog', 'LogID', req.LogID, { Status: 'cancelled' });
  }

  var requesterId = req.RequestedBy;
  if (requesterId) {
    appendRow('Inbox', {
      InboxID: generateUUID(),
      EmployeeID: requesterId,
      Type: 'delete_result',
      Title: approve ? 'คำขอลบได้รับอนุมัติ' : 'คำขอลบถูกปฏิเสธ',
      Message: (approve ? 'อนุมัติ' : 'ปฏิเสธ') + 'คำขอลบรายการ ' + req.LogID + (note ? (' หมายเหตุ: ' + note) : ''),
      RefID: requestId,
      Status: 'unread',
      CreatedAt: formatDate(new Date()),
      CreatedBy: user.employeeId
    });
  }

  writeActionLog(user.employeeId, user.name, approve ? 'approve_delete_production' : 'reject_delete_production', {
    requestId: requestId,
    logId: req.LogID,
    note: note || ''
  });

  return { success: true, message: approve ? 'อนุมัติการลบเรียบร้อย' : 'ปฏิเสธคำขอเรียบร้อย' };
}

function updateProductionEntry(token, logId, updates) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }

  var log = findRow('ProductionLog', 'LogID', logId);
  if (!log) {
    return { success: false, message: 'ไม่พบรายการ' };
  }
  if (log.Status === 'cancelled') {
    return { success: false, message: 'ไม่สามารถแก้ไขรายการที่ยกเลิกแล้ว' };
  }
  if (!canEditProductionLog(user, log, new Date())) {
    return { success: false, message: 'แก้ไขได้เฉพาะรายการของตนเองภายใน 2 วัน' };
  }

  updates = updates || {};
  var patch = {};
  var actualQty = Number(updates.actualQty);
  var defectQty = Number(updates.defectQty);
  var plannedQty = Number(updates.plannedQty);

  if (!isNaN(plannedQty)) {
    if (plannedQty < 0) return { success: false, message: 'จำนวนแผนไม่ถูกต้อง' };
    patch.PlannedQty = plannedQty;
  }
  if (!isNaN(actualQty)) {
    patch.ActualQty = actualQty;
  }
  if (!isNaN(defectQty)) {
    if (defectQty < 0) return { success: false, message: 'จำนวนของเสียไม่ถูกต้อง' };
    patch.DefectQty = defectQty;
  }
  if (typeof updates.remark === 'string') {
    patch.Remark = updates.remark;
  }
  if (typeof updates.timePeriod === 'string' && updates.timePeriod) {
    patch.TimePeriod = updates.timePeriod;
  }

  var defectByComponent = updates.defectByComponent;
  if (defectByComponent && typeof defectByComponent === 'object') {
    var defectMax = 0;
    for (var c in defectByComponent) {
      if (!defectByComponent.hasOwnProperty(c)) continue;
      var q = Number(defectByComponent[c].qty) || 0;
      if (q < 0) return { success: false, message: 'จำนวนของเสียไม่ถูกต้อง' };
      if (q > defectMax) defectMax = q;
    }
    patch.DefectQty = defectMax;
    patch.DefectDetails = Object.keys(defectByComponent).length ? JSON.stringify(defectByComponent) : '';
  }

  var nextActualQty = patch.hasOwnProperty('ActualQty') ? Number(patch.ActualQty) : Number(log.ActualQty);
  var nextDefectQty = patch.hasOwnProperty('DefectQty') ? Number(patch.DefectQty) : Number(log.DefectQty);
  if (!isNaN(nextActualQty) && !isNaN(nextDefectQty) && nextDefectQty > 0 && nextActualQty >= 0) {
    patch.ActualQty = 0;
  }

  if (Object.keys(patch).length === 0) {
    return { success: false, message: 'ไม่มีข้อมูลที่ต้องการแก้ไข' };
  }

  updateRow('ProductionLog', 'LogID', logId, patch);
  writeActionLog(user.employeeId, user.name, 'update_production_entry', {
    logId: logId,
    updates: patch
  });
  return { success: true, message: 'แก้ไขยอดผลิตเรียบร้อย' };
}

function canEditProductionLog(user, log, now) {
  if (user.role === 'admin') return true;
  if (log.EmployeeID !== user.employeeId) return false;
  var ts = new Date(log.Timestamp);
  if (isNaN(ts.getTime())) return false;
  var diffMs = now.getTime() - ts.getTime();
  return diffMs >= 0 && diffMs <= (2 * 24 * 60 * 60 * 1000);
}

function getInbox(token) {
  var user = validateSession(token);
  if (!user) return [];
  ensureAuxiliarySheetsForWorkflow();
  ensureDailyAmChecksheetInbox(user);
  var items = findRows('Inbox', function(it) {
    return String(it.EmployeeID) === String(user.employeeId);
  });
  items.sort(function(a, b) { return new Date(b.CreatedAt) - new Date(a.CreatedAt); });
  return items.slice(0, 100);
}

function ensureDailyAmChecksheetInbox(user) {
  var role = user && user.role ? String(user.role).toLowerCase() : '';
  if (role !== 'operator') return;

  var workDate = formatDateOnly(new Date());
  var refId = 'am_checksheet_' + workDate;
  var existing = findRows('Inbox', function(it) {
    return String(it.EmployeeID) === String(user.employeeId) && String(it.RefID) === refId;
  });
  if (existing && existing.length) return;

  appendRow('Inbox', {
    InboxID: generateUUID(),
    EmployeeID: user.employeeId,
    Type: 'am_checksheet',
    Title: 'AM Check Sheet ประจำวัน',
    Message: 'กรุณาทำ AM Check Sheet ประจำวันที่ ' + workDate,
    RefID: refId,
    Status: 'unread',
    CreatedAt: formatDate(new Date()),
    CreatedBy: 'system'
  });
}

function markInboxRead(token, inboxId) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  var row = findRow('Inbox', 'InboxID', inboxId);
  if (!row || String(row.EmployeeID) !== String(user.employeeId)) {
    return { success: false, message: 'ไม่พบข้อความ' };
  }
  updateRow('Inbox', 'InboxID', inboxId, { Status: 'read' });
  return { success: true };
}

function getActionLogs(token, limit) {
  var user = validateSession(token);
  if (!user) return [];
  ensureAuxiliarySheetsForWorkflow();
  var max = Number(limit) || 50;
  var logs = getAllRows('ActionLog');
  if (user.role !== 'admin') {
    logs = logs.filter(function(l) { return String(l.EmployeeID) === String(user.employeeId); });
  }
  logs.sort(function(a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); });
  return logs.slice(0, max);
}

function ensureAuxiliarySheetsForWorkflow() {
  var ss = getSpreadsheet();
  createSheetIfNotExists(ss, 'ProductionDeleteRequests',
    ['RequestID', 'LogID', 'RequestedAt', 'RequestedBy', 'RequesterName', 'Reason', 'Status', 'ReviewedBy', 'ReviewedAt', 'ReviewNote', 'Snapshot']);
  createSheetIfNotExists(ss, 'Inbox',
    ['InboxID', 'EmployeeID', 'Type', 'Title', 'Message', 'RefID', 'Status', 'CreatedAt', 'CreatedBy']);
  createSheetIfNotExists(ss, 'ActionLog',
    ['ActionID', 'Timestamp', 'EmployeeID', 'EmployeeName', 'Action', 'Payload']);
}

function writeActionLog(employeeId, employeeName, action, payload) {
  ensureAuxiliarySheetsForWorkflow();
  appendRow('ActionLog', {
    ActionID: generateUUID(),
    Timestamp: formatDate(new Date()),
    EmployeeID: employeeId || '',
    EmployeeName: employeeName || '',
    Action: action || '',
    Payload: payload ? JSON.stringify(payload) : ''
  });
}

function getProductionSummary(dateFrom, dateTo) {
  var logs = findRows('ProductionLog', function(row) {
    return row.Date >= dateFrom && row.Date <= dateTo && row.Status !== 'cancelled';
  });

  var summary = {};
  logs.forEach(function(log) {
    var key = log.MachineID + '|' + log.ProductCode;
    if (!summary[key]) {
      summary[key] = {
        machineId: log.MachineID,
        productCode: log.ProductCode,
        totalPlanned: 0,
        totalActual: 0,
        totalDefect: 0,
        entries: 0
      };
    }
    summary[key].totalPlanned += Number(log.PlannedQty) || 0;
    summary[key].totalActual += Number(log.ActualQty) || 0;
    summary[key].totalDefect += Number(log.DefectQty) || 0;
    summary[key].entries++;
  });

  return Object.keys(summary).map(function(key) { return summary[key]; });
}
