/**
 * Production Log Service
 * Handles production entry, history, and summaries
 */

function submitProduction(token, data) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }

  if (!data.machineId || !data.productCode) {
    return { success: false, message: 'กรุณาเลือกเครื่องจักรและผลิตภัณฑ์' };
  }

  ensureColumnExists('ProductionLog', 'DefectDetails');

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

  // Use shift from user profile (set by admin)
  var shift = user.shift || '';

  appendRow('ProductionLog', {
    LogID: logId,
    Timestamp: formatDate(now),
    Date: workDate,
    Shift: shift,
    TimePeriod: data.timePeriod || detectTimePeriod(now),
    EmployeeID: user.employeeId,
    EmployeeName: user.name,
    MachineID: data.machineId,
    ProductCode: data.productCode,
    PlannedQty: data.plannedQty || 1300,
    ActualQty: actualQty,
    DefectQty: finalDefectQty,
    DefectDetails: Object.keys(defectByComponent).length > 0 ? JSON.stringify(defectByComponent) : '',
    Remark: data.remark || '',
    Status: 'completed'
  });

  writeActionLog(user.employeeId, user.name, 'submit_production', {
    machineId: data.machineId,
    productCode: data.productCode,
    actualQty: actualQty,
    defectQty: finalDefectQty
  });

  return { success: true, logId: logId, message: 'บันทึกยอดผลิตเรียบร้อย' };
}

function getProductionHistory(token, filters) {
  var user = validateSession(token);
  if (!user) return [];

  var logs = getAllRows('ProductionLog');

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
  return getProductionHistory(token, {
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
  var logs = getProductionHistory(token, { employeeId: user.employeeId });

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
  var user = validateSession(token);
  if (!user) return [];

  filters = filters || {};
  var logs = [];

  if (user.role === 'admin') {
    logs = getProductionHistory(token, filters);
  } else {
    logs = getProductionHistory(token, { employeeId: user.employeeId });
    var now = new Date();
    var cutoff = new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000));
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
