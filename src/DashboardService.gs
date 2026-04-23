/**
 * Dashboard Data Analysis Service
 */

function getDashboardData(token, dateRange, shiftABFilter, shiftDNFilter) {
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

  if (shiftABFilter && shiftABFilter !== 'all') {
    productionLogs = productionLogs.filter(function(log) {
      return String(log.Shift || '') === String(shiftABFilter);
    });
  }

  if (shiftDNFilter && shiftDNFilter !== 'all') {
    productionLogs = productionLogs.filter(function(log) {
      return detectShiftBucketFromLog(log) === shiftDNFilter;
    });
  }

  // Capacity map (used for capacity-aligned plan calculations)
  var machineMap = {};
  getMachines().forEach(function(m) {
    machineMap[m.machineId] = m;
  });

  function getPlanQtyFromCapacity(log) {
    var cap = (machineMap[log.MachineID] && Number(machineMap[log.MachineID].capacity)) || 0;
    if (cap > 0) return cap; // hourly planned qty aligned to machine capacity
    return Number(log.PlannedQty) || 0; // fallback for machines without configured capacity
  }

  // KPI calculations
  var totalOutput = 0;
  var totalPlanned = 0;
  var totalDefect = 0;

  productionLogs.forEach(function(log) {
    totalOutput += Number(log.ActualQty) || 0;
    totalPlanned += getPlanQtyFromCapacity(log);
    totalDefect += Number(log.DefectQty) || 0;
  });

  var defectRate = totalOutput > 0 ? ((totalDefect / totalOutput) * 100).toFixed(2) : 0;
  var achievementRate = totalPlanned > 0 ? ((totalOutput / totalPlanned) * 100).toFixed(1) : 0;

  // Production by machine
  var scheduledHoursInRange = getScheduledHoursFromLogs(productionLogs, shiftDNFilter);
  var byMachine = {};
  productionLogs.forEach(function(log) {
    if (!byMachine[log.MachineID]) {
      byMachine[log.MachineID] = {
        planned: 0,
        actual: 0,
        defect: 0,
        entries: 0,
        productiveHours: 0,
        loggedHours: 0,
        scheduledHours: scheduledHoursInRange,
        otHours: 0,
        workingHours: 0,
        _hourKeys: {},
        _productiveHourKeys: {},
        capacity: 0,
        capacityTotal: 0,
        oeeRate: 0
      };
    }
    var bm = byMachine[log.MachineID];
    var actual = Number(log.ActualQty) || 0;
    var defect = Number(log.DefectQty) || 0;
    bm.planned += getPlanQtyFromCapacity(log);
    bm.actual += actual;
    bm.defect += defect;
    bm.entries++;

    // Count logged hours from ProductionLog (used for OT auto-detection)
    var hourKey = String(log.Date || '') + '|' + String(log.TimePeriod || '');
    if (hourKey !== '|') {
      if (!bm._hourKeys[hourKey]) {
        bm._hourKeys[hourKey] = true;
        bm.loggedHours++;
      }
    }

    // Keep productiveHours for compatibility/analytics
    if ((actual + defect) > 0 && hourKey !== '|') {
      if (!bm._productiveHourKeys[hourKey]) {
        bm._productiveHourKeys[hourKey] = true;
        bm.productiveHours++;
      }
    }
  });

  Object.keys(byMachine).forEach(function(mid) {
    var cap = (machineMap[mid] && Number(machineMap[mid].capacity)) || 0;
    var scheduledHours = Number(byMachine[mid].scheduledHours) || 0;
    var loggedHours = Number(byMachine[mid].loggedHours) || 0;
    var otHours = loggedHours > scheduledHours ? (loggedHours - scheduledHours) : 0;
    var workingHours = scheduledHours + otHours; // auto-detect OT by excess logged hours

    byMachine[mid].scheduledHours = scheduledHours;
    byMachine[mid].otHours = otHours;
    byMachine[mid].workingHours = workingHours;
    byMachine[mid].capacity = cap;
    byMachine[mid].capacityTotal = cap * workingHours;
    byMachine[mid].oeeRate = byMachine[mid].capacityTotal > 0
      ? Number(((byMachine[mid].actual / byMachine[mid].capacityTotal) * 100).toFixed(1))
      : 0;
    delete byMachine[mid]._hourKeys;
    delete byMachine[mid]._productiveHourKeys;
  });

  // Production by product
  var byProduct = {};
  productionLogs.forEach(function(log) {
    if (!byProduct[log.ProductCode]) {
      byProduct[log.ProductCode] = { planned: 0, actual: 0, defect: 0 };
    }
    byProduct[log.ProductCode].planned += getPlanQtyFromCapacity(log);
    byProduct[log.ProductCode].actual += Number(log.ActualQty) || 0;
    byProduct[log.ProductCode].defect += Number(log.DefectQty) || 0;
  });

  // Production by shift (A/B)
  var byShift = { A: { actual: 0, planned: 0, defect: 0 }, B: { actual: 0, planned: 0, defect: 0 } };
  productionLogs.forEach(function(log) {
    var shift = log.Shift || 'A';
    if (!byShift[shift]) byShift[shift] = { actual: 0, planned: 0, defect: 0 };
    byShift[shift].actual += Number(log.ActualQty) || 0;
    byShift[shift].planned += getPlanQtyFromCapacity(log);
    byShift[shift].defect += Number(log.DefectQty) || 0;
  });

  // Daily trend
  var dailyTrend = {};
  var dailyTrendDetails = {};
  productionLogs.forEach(function(log) {
    var dateKey = String(log.Date || '');
    var machineId = String(log.MachineID || '-');
    var plannedQty = getPlanQtyFromCapacity(log);
    var actualQty = Number(log.ActualQty) || 0;
    var defectQty = Number(log.DefectQty) || 0;
    var hourKey = String(log.TimePeriod || '-');

    if (!dailyTrend[log.Date]) {
      dailyTrend[log.Date] = { actual: 0, planned: 0, defect: 0 };
    }
    dailyTrend[log.Date].actual += actualQty;
    dailyTrend[log.Date].planned += plannedQty;
    dailyTrend[log.Date].defect += defectQty;

    if (!dailyTrendDetails[dateKey]) {
      dailyTrendDetails[dateKey] = { actual: 0, planned: 0, defect: 0, entries: 0, byMachine: {} };
    }
    var dayDetail = dailyTrendDetails[dateKey];
    dayDetail.actual += actualQty;
    dayDetail.planned += plannedQty;
    dayDetail.defect += defectQty;
    dayDetail.entries += 1;

    if (!dayDetail.byMachine[machineId]) {
      dayDetail.byMachine[machineId] = { entries: 0, planned: 0, actual: 0, defect: 0, hours: {} };
    }
    var machineDetail = dayDetail.byMachine[machineId];
    machineDetail.entries += 1;
    machineDetail.planned += plannedQty;
    machineDetail.actual += actualQty;
    machineDetail.defect += defectQty;
    machineDetail.hours[hourKey] = true;
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
    dailyTrendDetails: dailyTrendDetails,
    maintenance: maintenanceSummary,
    byEmployee: byEmployee
  };
}

function detectShiftBucketFromLog(log) {
  var period = String((log && log.TimePeriod) || '');
  var hour = -1;
  if (period && period.indexOf(':') > 0) {
    hour = Number(period.split(':')[0]);
  }
  if (isNaN(hour) || hour < 0) {
    try {
      hour = Number(String((log && log.Timestamp) || '').split(' ')[1].split(':')[0]);
    } catch (e) { hour = -1; }
  }
  if (hour < 0) return '';
  return (hour >= 8 && hour < 20) ? 'day' : 'night';
}

function getScheduledHoursFromLogs(productionLogs, shiftDNFilter) {
  var logs = Array.isArray(productionLogs) ? productionLogs : [];
  if (!logs.length) return 0;
  var mode = String(shiftDNFilter || 'all').toLowerCase();
  var dayNetHours = 10.5;
  var nightNetHours = 10.5;
  var byDate = {};

  logs.forEach(function(log) {
    var d = String((log && log.Date) || '');
    if (!d) return;
    var bucket = detectShiftBucketFromLog(log);
    if (!bucket) return;
    if (!byDate[d]) byDate[d] = { day: false, night: false };
    byDate[d][bucket] = true;
  });

  var dates = Object.keys(byDate);
  if (!dates.length) return 0;

  if (mode === 'day') {
    return dates.filter(function(d) { return byDate[d].day; }).length * dayNetHours;
  }
  if (mode === 'night') {
    return dates.filter(function(d) { return byDate[d].night; }).length * nightNetHours;
  }

  var total = 0;
  dates.forEach(function(d) {
    if (byDate[d].day) total += dayNetHours;
    if (byDate[d].night) total += nightNetHours;
  });
  return total;
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
