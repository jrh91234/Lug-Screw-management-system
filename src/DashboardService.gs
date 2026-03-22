/**
 * Dashboard Data Analysis Service
 */

function getDashboardData(token, dateRange) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }

  var dateFrom, dateTo;
  var today = formatDateOnly(new Date());

  switch (dateRange) {
    case 'today':
      dateFrom = today;
      dateTo = today;
      break;
    case 'week':
      dateFrom = formatDateOnly(getWeekStart());
      dateTo = today;
      break;
    case 'month':
      dateFrom = formatDateOnly(getMonthStart());
      dateTo = today;
      break;
    default:
      if (dateRange && dateRange.from && dateRange.to) {
        dateFrom = dateRange.from;
        dateTo = dateRange.to;
      } else {
        dateFrom = today;
        dateTo = today;
      }
  }

  // Production data
  var productionLogs = findRows('ProductionLog', function(row) {
    return row.Date >= dateFrom && row.Date <= dateTo && row.Status !== 'cancelled';
  });

  // KPI calculations
  var totalOutput = 0;
  var totalPlanned = 0;
  var totalDefect = 0;

  productionLogs.forEach(function(log) {
    totalOutput += Number(log.ActualQty) || 0;
    totalPlanned += Number(log.PlannedQty) || 0;
    totalDefect += Number(log.DefectQty) || 0;
  });

  var defectRate = totalOutput > 0 ? ((totalDefect / totalOutput) * 100).toFixed(2) : 0;
  var achievementRate = totalPlanned > 0 ? ((totalOutput / totalPlanned) * 100).toFixed(1) : 0;

  // Production by machine
  var byMachine = {};
  productionLogs.forEach(function(log) {
    if (!byMachine[log.MachineID]) {
      byMachine[log.MachineID] = { planned: 0, actual: 0, defect: 0, entries: 0 };
    }
    byMachine[log.MachineID].planned += Number(log.PlannedQty) || 0;
    byMachine[log.MachineID].actual += Number(log.ActualQty) || 0;
    byMachine[log.MachineID].defect += Number(log.DefectQty) || 0;
    byMachine[log.MachineID].entries++;
  });

  // Production by product
  var byProduct = {};
  productionLogs.forEach(function(log) {
    if (!byProduct[log.ProductCode]) {
      byProduct[log.ProductCode] = { planned: 0, actual: 0, defect: 0 };
    }
    byProduct[log.ProductCode].planned += Number(log.PlannedQty) || 0;
    byProduct[log.ProductCode].actual += Number(log.ActualQty) || 0;
    byProduct[log.ProductCode].defect += Number(log.DefectQty) || 0;
  });

  // Production by shift (A/B)
  var byShift = { A: { actual: 0, planned: 0, defect: 0 }, B: { actual: 0, planned: 0, defect: 0 } };
  productionLogs.forEach(function(log) {
    var shift = log.Shift || 'A';
    if (!byShift[shift]) byShift[shift] = { actual: 0, planned: 0, defect: 0 };
    byShift[shift].actual += Number(log.ActualQty) || 0;
    byShift[shift].planned += Number(log.PlannedQty) || 0;
    byShift[shift].defect += Number(log.DefectQty) || 0;
  });

  // Daily trend
  var dailyTrend = {};
  productionLogs.forEach(function(log) {
    if (!dailyTrend[log.Date]) {
      dailyTrend[log.Date] = { actual: 0, planned: 0, defect: 0 };
    }
    dailyTrend[log.Date].actual += Number(log.ActualQty) || 0;
    dailyTrend[log.Date].planned += Number(log.PlannedQty) || 0;
    dailyTrend[log.Date].defect += Number(log.DefectQty) || 0;
  });

  // Maintenance summary
  var maintenanceSummary = getMaintenanceSummary(dateFrom, dateTo);

  // Machine status
  var machines = getMachines();
  var runningMachines = machines.filter(function(m) { return m.status === 'running'; }).length;
  var machineUtilization = machines.length > 0 ? ((runningMachines / machines.length) * 100).toFixed(1) : 0;

  // Top employees
  var byEmployee = {};
  productionLogs.forEach(function(log) {
    if (!byEmployee[log.EmployeeName]) {
      byEmployee[log.EmployeeName] = 0;
    }
    byEmployee[log.EmployeeName] += Number(log.ActualQty) || 0;
  });

  return {
    success: true,
    dateRange: { from: dateFrom, to: dateTo },
    kpi: {
      totalOutput: totalOutput,
      totalPlanned: totalPlanned,
      totalDefect: totalDefect,
      defectRate: Number(defectRate),
      achievementRate: Number(achievementRate),
      machineUtilization: Number(machineUtilization),
      openTickets: maintenanceSummary.openTickets,
      totalEntries: productionLogs.length
    },
    byMachine: byMachine,
    byProduct: byProduct,
    byShift: byShift,
    dailyTrend: dailyTrend,
    maintenance: maintenanceSummary,
    byEmployee: byEmployee
  };
}

function getSortedProductionData(token, sortField, sortOrder, filters) {
  var logs = getProductionHistory(token, filters);

  if (sortField) {
    logs.sort(function(a, b) {
      var valA = a[sortField];
      var valB = b[sortField];

      if (!isNaN(Number(valA)) && !isNaN(Number(valB))) {
        valA = Number(valA);
        valB = Number(valB);
      }

      if (sortOrder === 'desc') {
        return valA > valB ? -1 : valA < valB ? 1 : 0;
      }
      return valA > valB ? 1 : valA < valB ? -1 : 0;
    });
  }

  return logs;
}

function exportProductionCSV(token, dateFrom, dateTo) {
  if (!hasRole(token, 'supervisor')) {
    return { success: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  }

  var logs = getProductionHistory(token, { dateFrom: dateFrom, dateTo: dateTo });

  if (logs.length === 0) {
    return { success: false, message: 'ไม่พบข้อมูล' };
  }

  var headers = ['Date', 'Shift', 'EmployeeName', 'MachineID', 'ProductCode', 'PlannedQty', 'ActualQty', 'DefectQty', 'Status', 'Remark'];
  var csv = headers.join(',') + '\n';

  logs.forEach(function(log) {
    var row = headers.map(function(h) {
      var val = String(log[h] || '');
      if (val.indexOf(',') !== -1 || val.indexOf('"') !== -1) {
        val = '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    });
    csv += row.join(',') + '\n';
  });

  return { success: true, csv: csv, filename: 'production_' + dateFrom + '_' + dateTo + '.csv' };
}
