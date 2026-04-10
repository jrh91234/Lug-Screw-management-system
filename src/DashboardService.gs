/**
 * Dashboard Data Analysis Service
 */

function getDashboardData(token, dateRange, shiftFilter) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }

  var dateFrom, dateTo;
  var today = getWorkDate(new Date());

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

  if (shiftFilter && shiftFilter !== 'all') {
    productionLogs = productionLogs.filter(function(log) {
      if (shiftFilter === 'A' || shiftFilter === 'B') {
        return String(log.Shift || '') === String(shiftFilter);
      }
      if (shiftFilter === 'day' || shiftFilter === 'night') {
        var period = String(log.TimePeriod || '');
        var hour = -1;
        if (period && period.indexOf(':') > 0) {
          hour = Number(period.split(':')[0]);
        }
        if (isNaN(hour) || hour < 0) {
          try {
            hour = Number(String(log.Timestamp || '').split(' ')[1].split(':')[0]);
          } catch (e) { hour = -1; }
        }
        if (hour < 0) return false;
        var bucket = (hour >= 8 && hour < 20) ? 'day' : 'night';
        return bucket === shiftFilter;
      }
      return true;
    });
  }

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
  var machineMap = {};
  getMachines().forEach(function(m) {
    machineMap[m.machineId] = m;
  });

  var byMachine = {};
  productionLogs.forEach(function(log) {
    if (!byMachine[log.MachineID]) {
      byMachine[log.MachineID] = {
        planned: 0,
        actual: 0,
        defect: 0,
        entries: 0,
        productiveHours: 0,
        _hourKeys: {},
        capacity: 0,
        capacityTotal: 0,
        oeeRate: 0
      };
    }
    var bm = byMachine[log.MachineID];
    var actual = Number(log.ActualQty) || 0;
    var defect = Number(log.DefectQty) || 0;
    bm.planned += Number(log.PlannedQty) || 0;
    bm.actual += actual;
    bm.defect += defect;
    bm.entries++;

    // Count only real production hours (unique Date+TimePeriod with actual work)
    if ((actual + defect) > 0) {
      var hourKey = String(log.Date || '') + '|' + String(log.TimePeriod || '');
      if (!bm._hourKeys[hourKey]) {
        bm._hourKeys[hourKey] = true;
        bm.productiveHours++;
      }
    }
  });

  Object.keys(byMachine).forEach(function(mid) {
    var cap = (machineMap[mid] && Number(machineMap[mid].capacity)) || 0;
    byMachine[mid].capacity = cap;
    byMachine[mid].capacityTotal = cap * byMachine[mid].productiveHours;
    byMachine[mid].oeeRate = byMachine[mid].capacityTotal > 0
      ? Number(((byMachine[mid].actual / byMachine[mid].capacityTotal) * 100).toFixed(1))
      : 0;
    delete byMachine[mid]._hourKeys;
  });

  Object.keys(byMachine).forEach(function(mid) {
    var cap = (machineMap[mid] && Number(machineMap[mid].capacity)) || 0;
    byMachine[mid].capacity = cap;
    byMachine[mid].capacityTotal = cap * byMachine[mid].entries;
    byMachine[mid].oeeRate = byMachine[mid].capacityTotal > 0
      ? Number(((byMachine[mid].actual / byMachine[mid].capacityTotal) * 100).toFixed(1))
      : 0;
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
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }
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
