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
    if (q > defectTotal) defectTotal = q;
  }

  var actualQty = Number(data.actualQty);
  if (defectTotal > 0) {
    actualQty = 0;
  }
  if (isNaN(actualQty) || actualQty < 0) {
    return { success: false, message: 'จำนวนผลิตไม่ถูกต้อง' };
  }

  var now = new Date();
  var logId = generateUUID();

  // Use shift from user profile (set by admin)
  var shift = user.shift || '';

  appendRow('ProductionLog', {
    LogID: logId,
    Timestamp: formatDate(now),
    Date: getWorkDate(now),
    Shift: shift,
    TimePeriod: data.timePeriod || detectTimePeriod(now),
    EmployeeID: user.employeeId,
    EmployeeName: user.name,
    MachineID: data.machineId,
    ProductCode: data.productCode,
    PlannedQty: data.plannedQty || 1300,
    ActualQty: actualQty,
    DefectQty: defectTotal > 0 ? defectTotal : (Number(data.defectQty) || 0),
    DefectDetails: Object.keys(defectByComponent).length > 0 ? JSON.stringify(defectByComponent) : '',
    Remark: data.remark || '',
    Status: 'completed'
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
