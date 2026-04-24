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
      return bucket === shiftDNFilter;
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
  var scheduledHoursInRange = (function() {
    var start = new Date(String(dateFrom) + 'T00:00:00');
    var end = new Date(String(dateTo) + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() < start.getTime()) {
      return 0;
    }
    var oneDayMs = 24 * 60 * 60 * 1000;
    var days = Math.floor((end.getTime() - start.getTime()) / oneDayMs) + 1;
    var mode = String(shiftDNFilter || 'all').toLowerCase();
    var dayNetHours = 10.5;
    var nightNetHours = 10.5;
    if (mode === 'day') return days * dayNetHours;
    if (mode === 'night') return days * nightNetHours;
    return days * (dayNetHours + nightNetHours);
  })();
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
  try {
    var trendDates = getDateKeysInRange(dateFrom, dateTo);
    var netHoursPerDay = getNetHoursPerDay(shiftDNFilter);
    var machineIds = Object.keys(machineMap);

    trendDates.forEach(function(d) {
      dailyTrend[d] = { actual: 0, planned: 0, defect: 0 };
      dailyTrendDetails[d] = {
        actual: 0,
        planned: 0,
        defect: 0,
        entries: 0,
        netHoursPerDay: netHoursPerDay,
        byMachine: {}
      };

      machineIds.forEach(function(mid) {
        var capPerHour = (machineMap[mid] && Number(machineMap[mid].capacity)) || 0;
        var machinePlanned = capPerHour * netHoursPerDay;
        dailyTrend[d].planned += machinePlanned;
        dailyTrendDetails[d].planned += machinePlanned;
        dailyTrendDetails[d].byMachine[mid] = {
          entries: 0,
          planned: machinePlanned,
          actual: 0,
          defect: 0,
          capacityPerHour: capPerHour,
          netHours: netHoursPerDay,
          hours: {}
        };
      });
    });

    productionLogs.forEach(function(log) {
      var dateKey = String(log.Date || '');
      if (!dailyTrend[dateKey]) return;
      var machineId = String(log.MachineID || '-');
      var actualQty = Number(log.ActualQty) || 0;
      var defectQty = Number(log.DefectQty) || 0;
      var hourKey = String(log.TimePeriod || '-');

      dailyTrend[dateKey].actual += actualQty;
      dailyTrend[dateKey].defect += defectQty;

      var dayDetail = dailyTrendDetails[dateKey];
      dayDetail.actual += actualQty;
      dayDetail.defect += defectQty;
      dayDetail.entries += 1;

      if (!dayDetail.byMachine[machineId]) {
        dayDetail.byMachine[machineId] = {
          entries: 0,
          planned: 0,
          actual: 0,
          defect: 0,
          capacityPerHour: (machineMap[machineId] && Number(machineMap[machineId].capacity)) || 0,
          netHours: netHoursPerDay,
          hours: {}
        };
      }
      var machineDetail = dayDetail.byMachine[machineId];
      machineDetail.entries += 1;
      machineDetail.actual += actualQty;
      machineDetail.defect += defectQty;
      machineDetail.hours[hourKey] = true;
    });
  } catch (trendErr) {
    Logger.log('Daily trend calculation fallback: ' + trendErr.message);
    productionLogs.forEach(function(log) {
      var d = String(log.Date || '');
      if (!d) return;
      if (!dailyTrend[d]) dailyTrend[d] = { actual: 0, planned: 0, defect: 0 };
      if (!dailyTrendDetails[d]) dailyTrendDetails[d] = { actual: 0, planned: 0, defect: 0, entries: 0, byMachine: {} };
      var plannedQty = getPlanQtyFromCapacity(log);
      var actualQty = Number(log.ActualQty) || 0;
      var defectQty = Number(log.DefectQty) || 0;
      dailyTrend[d].actual += actualQty;
      dailyTrend[d].planned += plannedQty;
      dailyTrend[d].defect += defectQty;
      dailyTrendDetails[d].actual += actualQty;
      dailyTrendDetails[d].planned += plannedQty;
      dailyTrendDetails[d].defect += defectQty;
      dailyTrendDetails[d].entries += 1;
    });
  }

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

function getScheduledHoursInRange(dateFrom, dateTo, shiftDNFilter) {
  var start = new Date(String(dateFrom) + 'T00:00:00');
  var end = new Date(String(dateTo) + 'T00:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() < start.getTime()) {
    return 0;
  }
  var oneDayMs = 24 * 60 * 60 * 1000;
  var days = Math.floor((end.getTime() - start.getTime()) / oneDayMs) + 1;
  var mode = String(shiftDNFilter || 'all').toLowerCase();

  // Shift schedule with break time deducted
  // Day shift breaks: 12:00-13:00 (1.0h), 17:00-17:30 (0.5h) => 10.5h net
  // Night shift breaks: 00:00-01:00 (1.0h), 05:00-05:30 (0.5h) => 10.5h net
  var dayNetHours = 10.5;
  var nightNetHours = 10.5;

  if (mode === 'day') return days * dayNetHours;
  if (mode === 'night') return days * nightNetHours;
  return days * (dayNetHours + nightNetHours); // all = 21h/day (breaks deducted)
}

function getNetHoursPerDay(shiftDNFilter) {
  var mode = String(shiftDNFilter || 'all').toLowerCase();
  var dayNetHours = 10.5;
  var nightNetHours = 10.5;
  if (mode === 'day') return dayNetHours;
  if (mode === 'night') return nightNetHours;
  return dayNetHours + nightNetHours;
}

function getDateKeysInRange(dateFrom, dateTo) {
  var start = new Date(String(dateFrom) + 'T00:00:00');
  var end = new Date(String(dateTo) + 'T00:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() < start.getTime()) {
    return [];
  }
  var result = [];
  var cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    result.push(Utilities.formatDate(cursor, 'Asia/Bangkok', 'yyyy-MM-dd'));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
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
