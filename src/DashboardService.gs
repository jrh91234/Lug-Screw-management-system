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
    if (String(log.Status) === 'sort-adjust') return 0; // sorting adjustment rows carry no planned capacity
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
  var rangeDaysCount = (function() {
    var start = new Date(String(dateFrom) + 'T00:00:00');
    var end = new Date(String(dateTo) + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() < start.getTime()) {
      return 0;
    }
    var oneDayMs = 24 * 60 * 60 * 1000;
    return Math.floor((end.getTime() - start.getTime()) / oneDayMs) + 1;
  })();
  var netHoursPerDayForRange = getNetHoursPerDay(shiftDNFilter);
  var scheduledHoursInRange = rangeDaysCount * netHoursPerDayForRange;

  // (machineId|date) cells where Lug/Screw ran out — excluded from OEE entirely
  var stockoutMap = getStockoutMachineDays(dateFrom, dateTo);
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
        oeeRate: 0,
        oeeActual: 0,
        oeeCapacityTotal: 0,
        stockoutDays: 0,
        countedDays: 0,
        _oeeDay: {}
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

    // Per-day tracking for OEE: zero-output days and Lug/Screw stockout days are dropped later
    var oeeDayKey = String(log.Date || '');
    if (oeeDayKey) {
      if (!bm._oeeDay[oeeDayKey]) bm._oeeDay[oeeDayKey] = { actual: 0, hourKeys: {} };
      bm._oeeDay[oeeDayKey].actual += actual;
      if (hourKey !== '|') bm._oeeDay[oeeDayKey].hourKeys[hourKey] = true;
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
    byMachine[mid].capacityTotal = cap * workingHours; // full theoretical capacity (display/planning)

    // OEE counts only (machine, day) cells that produced output AND were not Lug/Screw stockout days
    var oeeActual = 0;
    var oeeLoggedHours = 0;
    var countedDays = 0;
    var dayMap = byMachine[mid]._oeeDay || {};
    Object.keys(dayMap).forEach(function(dKey) {
      if (stockoutMap[mid + '|' + dKey]) return;          // Lug/Screw ran out that day
      var dayInfo = dayMap[dKey];
      if (!(Number(dayInfo.actual) > 0)) return;          // no output that day
      countedDays++;
      oeeActual += Number(dayInfo.actual) || 0;
      oeeLoggedHours += Object.keys(dayInfo.hourKeys || {}).length;
    });
    var oeeScheduledHours = countedDays * netHoursPerDayForRange;
    var oeeOtHours = oeeLoggedHours > oeeScheduledHours ? (oeeLoggedHours - oeeScheduledHours) : 0;
    var oeeWorkingHours = oeeScheduledHours + oeeOtHours;

    byMachine[mid].countedDays = countedDays;
    byMachine[mid].stockoutDays = countStockoutDaysForMachine(stockoutMap, mid);
    byMachine[mid].oeeActual = oeeActual;
    byMachine[mid].oeeWorkingHours = oeeWorkingHours;
    byMachine[mid].oeeCapacityTotal = cap * oeeWorkingHours;
    byMachine[mid].oeeRate = byMachine[mid].oeeCapacityTotal > 0
      ? Number(((oeeActual / byMachine[mid].oeeCapacityTotal) * 100).toFixed(1))
      : 0;

    delete byMachine[mid]._hourKeys;
    delete byMachine[mid]._productiveHourKeys;
    delete byMachine[mid]._oeeDay;
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
          oeeRate: 0,
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
          oeeRate: 0,
          hours: {}
        };
      }
      var machineDetail = dayDetail.byMachine[machineId];
      machineDetail.entries += 1;
      machineDetail.actual += actualQty;
      machineDetail.defect += defectQty;
      machineDetail.hours[hourKey] = true;
    });

    Object.keys(dailyTrendDetails).forEach(function(d) {
      var byMachineForDay = dailyTrendDetails[d].byMachine || {};
      Object.keys(byMachineForDay).forEach(function(mid) {
        var m = byMachineForDay[mid];
        var isStockout = !!stockoutMap[mid + '|' + d];
        var hasOutput = Number(m.actual) > 0;
        m.stockout = isStockout;
        // Exclude from OEE: Lug/Screw stockout days and zero-output days
        m.excludedFromOee = isStockout || !hasOutput;
        m.oeeRate = m.excludedFromOee
          ? null
          : (Number(m.planned) > 0
              ? Number(((Number(m.actual || 0) / Number(m.planned || 0)) * 100).toFixed(1))
              : 0);
      });
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
  var maintenanceSummary = getMaintenanceSummary(dateFrom, dateTo, shiftABFilter, shiftDNFilter);

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
  filters = filters || {};
  var logs = getProductionHistory(token, filters);

  if (filters.shiftAB && filters.shiftAB !== 'all') {
    var targetAB = String(filters.shiftAB || '');
    logs = logs.filter(function(log) {
      return String(log.Shift || '') === targetAB;
    });
  }

  if (filters.shiftDN && filters.shiftDN !== 'all') {
    var targetDN = String(filters.shiftDN || '').toLowerCase();
    logs = logs.filter(function(log) {
      return detectShiftBucketFromLog(log) === targetDN;
    });
  }

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

/**
 * Export the production NG (defect) list for QC, ITEMISED one row per defect item.
 * The DefectDetails JSON ({ componentCode: { componentName, qty } }) is expanded
 * into readable columns so QC can hand the list to the customer (no raw JSON).
 * Rows with no component breakdown fall back to a single line with the NG total.
 * Sorting adjustment rows (Status 'sort-adjust') are excluded — those are NG found
 * during sorting, not production NG.
 */
function exportQCDefectCSV(token, dateFrom, dateTo) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }
  if (!dateFrom || !dateTo) {
    return { success: false, message: 'กรุณาเลือกช่วงวันที่' };
  }

  var logs = getProductionHistory(token, { dateFrom: dateFrom, dateTo: dateTo });

  var headers = ['วันที่', 'กะ', 'รหัสสินค้า', 'เครื่อง', 'รหัส Component', 'ชื่อ Component', 'จำนวนเสีย (pcs)', 'ผู้บันทึก', 'หมายเหตุ', 'เลขที่บันทึก'];

  function esc(v) {
    var s = String(v == null ? '' : v);
    if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  var rows = [];
  var totalQty = 0;
  for (var i = 0; i < logs.length; i++) {
    var log = logs[i];
    var defectQty = Number(log.DefectQty) || 0;
    if (defectQty <= 0) continue;
    if (String(log.Status) === 'cancelled') continue;
    if (String(log.Status) === 'sort-adjust') continue;

    var details = {};
    if (log.DefectDetails) {
      try { details = JSON.parse(String(log.DefectDetails)); } catch (e) { details = {}; }
    }

    var compCodes = [];
    if (details && typeof details === 'object') {
      for (var k in details) {
        if (details.hasOwnProperty(k)) compCodes.push(k);
      }
    }

    if (compCodes.length > 0) {
      for (var c = 0; c < compCodes.length; c++) {
        var code = compCodes[c];
        var d = details[code] || {};
        var q = Number(d.qty) || 0;
        if (q <= 0) continue;
        totalQty += q;
        rows.push([log.Date, log.Shift, log.ProductCode, log.MachineID, code, d.componentName || '', q, log.EmployeeName, log.Remark, log.LogID]);
      }
    } else {
      totalQty += defectQty;
      rows.push([log.Date, log.Shift, log.ProductCode, log.MachineID, '-', '(ไม่ระบุ Component)', defectQty, log.EmployeeName, log.Remark, log.LogID]);
    }
  }

  if (rows.length === 0) {
    return { success: false, message: 'ไม่พบรายการ NG ในช่วงวันที่ที่เลือก' };
  }

  rows.sort(function(a, b) {
    if (String(a[0]) < String(b[0])) return -1;
    if (String(a[0]) > String(b[0])) return 1;
    return 0;
  });

  var csv = headers.join(',') + '\n';
  for (var r = 0; r < rows.length; r++) {
    csv += rows[r].map(esc).join(',') + '\n';
  }
  csv += esc('รวม') + ',,,,,,' + totalQty + ',,,\n';

  return {
    success: true,
    csv: csv,
    rows: rows.length,
    totalQty: totalQty,
    filename: 'NG_QC_' + dateFrom + '_to_' + dateTo + '.csv'
  };
}

// === Lug/Screw stockout detection (excluded from OEE) ===

/**
 * Build a set of (machineId|date) cells where Lug/Screw ran out within the range.
 * Detected from MaintenanceLog either by the dedicated "material" issue type
 * or by stockout keywords in the description (backward compatible with old tickets).
 * Returns an object map: { 'LS-04|2026-06-19': true, ... }
 */
function getStockoutMachineDays(dateFrom, dateTo) {
  var map = {};
  try {
    var logs = findRows('MaintenanceLog', function(row) {
      var d = stockoutWorkDate(row);
      return d && d >= dateFrom && d <= dateTo;
    });
    logs.forEach(function(log) {
      if (!isStockoutMaintenanceLog(log)) return;
      var mid = String(log.MachineID || '').trim();
      var d = stockoutWorkDate(log);
      if (!mid || !d) return;
      map[mid + '|' + d] = true;
    });
  } catch (e) {
    // MaintenanceLog may not exist yet — fail open (no exclusions)
    Logger.log('getStockoutMachineDays error: ' + e.message);
  }
  return map;
}

function countStockoutDaysForMachine(stockoutMap, machineId) {
  if (!stockoutMap || !machineId) return 0;
  var prefix = String(machineId) + '|';
  var count = 0;
  Object.keys(stockoutMap).forEach(function(k) {
    if (k.indexOf(prefix) === 0) count++;
  });
  return count;
}

function stockoutWorkDate(log) {
  var d = String((log && log.Date) || '').trim();
  if (d) return d;
  try {
    var ref = parseSheetDateTime(log.Timestamp);
    if (ref) return getWorkDate(ref);
  } catch (e) {}
  return '';
}

function isStockoutMaintenanceLog(log) {
  if (!log) return false;
  var type = String(log.IssueType || '').toLowerCase().trim();
  if (type === 'material' || type === 'stockout') return true;
  return isStockoutDescription(log.Description);
}

/**
 * Heuristic match for "Lug/Screw ran out" written in a free-text description.
 * Requires both an "out/empty" signal and a material reference to avoid
 * false positives (e.g. "ลมหมด" / "เวลาหมด" are not stockouts).
 */
function isStockoutDescription(desc) {
  var s = String(desc || '').toLowerCase();
  if (!s) return false;
  var patterns = [
    /lug[\s\S]{0,20}หมด/, /screw[\s\S]{0,20}หมด/,
    /หมด[\s\S]{0,20}lug/, /หมด[\s\S]{0,20}screw/,
    /วัตถุดิบ[\s\S]{0,20}หมด/, /หมด[\s\S]{0,20}วัตถุดิบ/,
    /วัตถุดิบหมด/, /ของหมด/, /รอวัตถุดิบ/, /ขาดวัตถุดิบ/,
    /ไม่มีวัตถุดิบ/, /ไม่มีของ/,
    /out\s*of\s*stock/, /no\s*material/, /material[\s\S]{0,10}out/, /run[\s\S]{0,5}out/
  ];
  for (var i = 0; i < patterns.length; i++) {
    if (patterns[i].test(s)) return true;
  }
  return false;
}
