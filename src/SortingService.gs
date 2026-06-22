/**
 * Sorting Job Management Service
 * จัดการงานคัดแยก (Sort) สำหรับ Lug & Screw
 */

var SORTING_HEADERS = ['JobID', 'Timestamp', 'Date', 'Shift', 'ShiftDN', 'MachineID', 'ProductCode', 'FoundProcess', 'TotalQty', 'GoodQty', 'DefectQty', 'DefectLug', 'DefectScrew', 'DefectScrewLug', 'Status', 'RegisteredBy', 'RegisteredByName', 'SortedBy', 'SortedByName', 'PulledAt', 'CompletedAt', 'Remark'];

function ensureSortingColumns() {
  // Self-heal: create the SortingLog sheet if it was never set up by initializeSystem()
  ensureSheetExists('SortingLog', SORTING_HEADERS);
  ensureColumnExists('SortingLog', 'DefectLug');
  ensureColumnExists('SortingLog', 'DefectScrew');
  ensureColumnExists('SortingLog', 'DefectScrewLug');
  ensureColumnExists('SortingLog', 'SortedBy');
  ensureColumnExists('SortingLog', 'SortedByName');
  ensureColumnExists('SortingLog', 'PulledAt');
}

function submitSortingJob(token, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  if (!data.machineId) return { success: false, message: 'กรุณาเลือกเครื่องจักร' };
  if (!data.foundProcess) return { success: false, message: 'กรุณาเลือกกระบวนการที่พบ' };
  var totalQty = Number(data.totalQty);
  if (!data.totalQty || isNaN(totalQty) || totalQty <= 0) {
    return { success: false, message: 'กรุณากรอกจำนวนที่ต้อง sort' };
  }

  ensureSortingColumns();
  var now = new Date();
  var jobId = 'ST-' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase();
  var shiftDN = detectShift(now);

  appendRow('SortingLog', {
    JobID: jobId,
    Timestamp: formatDate(now),
    Date: getWorkDate(now),
    Shift: data.shift || user.shift || '',
    ShiftDN: shiftDN,
    MachineID: data.machineId,
    ProductCode: data.productCode || '',
    FoundProcess: data.foundProcess,
    TotalQty: totalQty,
    GoodQty: 0,
    DefectQty: 0,
    DefectLug: 0,
    DefectScrew: 0,
    DefectScrewLug: 0,
    Status: 'pending',
    RegisteredBy: user.employeeId,
    RegisteredByName: user.name,
    SortedBy: '',
    SortedByName: '',
    PulledAt: '',
    CompletedAt: '',
    Remark: data.remark || ''
  });

  return { success: true, jobId: jobId, message: 'ลงทะเบียนงาน sort สำเร็จ: ' + jobId };
}

/**
 * Return a pulled job back to pending (only if no results recorded yet).
 */
function returnSortingJob(token, jobId) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  ensureSortingColumns();
  var job = findRow('SortingLog', 'JobID', jobId);
  if (!job) return { success: false, message: 'ไม่พบงาน sort: ' + jobId };
  if (String(job.Status) !== 'in-progress') {
    return { success: false, message: 'คืนงานได้เฉพาะงานที่กำลังดำเนินการ' };
  }
  if ((Number(job.GoodQty) || 0) > 0 || (Number(job.DefectQty) || 0) > 0) {
    return { success: false, message: 'ไม่สามารถคืนงานได้ เนื่องจากบันทึกผลไปแล้ว' };
  }

  updateRow('SortingLog', 'JobID', jobId, {
    Status: 'pending',
    SortedBy: '',
    SortedByName: '',
    PulledAt: ''
  });
  return { success: true, message: 'คืนงานสำเร็จ: ' + jobId };
}

/**
 * Pull (claim) a registered job to start sorting.
 */
function pullSortingJob(token, jobId) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  ensureSortingColumns();
  var job = findRow('SortingLog', 'JobID', jobId);
  if (!job) return { success: false, message: 'ไม่พบงาน sort: ' + jobId };
  if (String(job.Status) === 'completed') {
    return { success: false, message: 'งานนี้คัดแยกเสร็จแล้ว' };
  }

  var changes = {
    Status: 'in-progress',
    SortedBy: user.employeeId,
    SortedByName: user.name
  };
  if (!job.PulledAt) changes.PulledAt = formatDate(new Date());

  updateRow('SortingLog', 'JobID', jobId, changes);
  return { success: true, message: 'ดึงงานไปคัดแยกแล้ว: ' + jobId };
}

function updateSortingJob(token, jobId, updates) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  var job = findRow('SortingLog', 'JobID', jobId);
  if (!job) return { success: false, message: 'ไม่พบงาน sort: ' + jobId };

  var changes = {};

  if (updates.goodQty !== undefined) {
    var goodQty = Number(updates.goodQty);
    if (isNaN(goodQty) || goodQty < 0) return { success: false, message: 'จำนวนดีไม่ถูกต้อง' };
    changes.GoodQty = goodQty;
  }

  if (updates.defectQty !== undefined) {
    var defectQty = Number(updates.defectQty);
    if (isNaN(defectQty) || defectQty < 0) return { success: false, message: 'จำนวนเสียไม่ถูกต้อง' };
    changes.DefectQty = defectQty;
  }

  if (updates.status) {
    changes.Status = updates.status;
    if (updates.status === 'completed') {
      changes.CompletedAt = formatDate(new Date());
    }
  }

  if (updates.remark !== undefined) {
    changes.Remark = updates.remark;
  }

  updateRow('SortingLog', 'JobID', jobId, changes);
  return { success: true, message: 'อัปเดตงาน sort สำเร็จ' };
}

/**
 * Record a sorting result. Quantities are INCREMENTS that accumulate onto the
 * job's running totals (so a job can be sorted in several rounds). Defects are
 * split into Lug / Screw / Screw+Lug. Each round also posts a ProductionLog
 * adjustment so production totals stay correct (see postSortingProductionAdjustment).
 */
function recordSortingResult(token, jobId, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  ensureSortingColumns();
  var job = findRow('SortingLog', 'JobID', jobId);
  if (!job) return { success: false, message: 'ไม่พบงาน sort: ' + jobId };

  var goodInc = Number(data.goodQty) || 0;
  var lugInc = Number(data.defectLug) || 0;
  var screwInc = Number(data.defectScrew) || 0;
  var screwLugInc = Number(data.defectScrewLug) || 0;
  if (goodInc < 0 || lugInc < 0 || screwInc < 0 || screwLugInc < 0) {
    return { success: false, message: 'จำนวนต้องไม่ติดลบ' };
  }
  var defectInc = lugInc + screwInc + screwLugInc;
  if (goodInc === 0 && defectInc === 0) {
    return { success: false, message: 'กรุณากรอกจำนวนอย่างน้อย 1 ช่อง' };
  }

  // Accumulate onto running totals
  var newGood = (Number(job.GoodQty) || 0) + goodInc;
  var newDefect = (Number(job.DefectQty) || 0) + defectInc;
  var newLug = (Number(job.DefectLug) || 0) + lugInc;
  var newScrew = (Number(job.DefectScrew) || 0) + screwInc;
  var newScrewLug = (Number(job.DefectScrewLug) || 0) + screwLugInc;

  var totalQty = Number(job.TotalQty) || 0;
  var totalSorted = newGood + newDefect;
  var newStatus = (totalQty > 0 && totalSorted >= totalQty) ? 'completed' : 'in-progress';

  var changes = {
    GoodQty: newGood,
    DefectQty: newDefect,
    DefectLug: newLug,
    DefectScrew: newScrew,
    DefectScrewLug: newScrewLug,
    Status: newStatus
  };
  if (!job.SortedBy) {
    changes.SortedBy = user.employeeId;
    changes.SortedByName = user.name;
  }
  if (!job.PulledAt) changes.PulledAt = formatDate(new Date());
  if (newStatus === 'completed') changes.CompletedAt = formatDate(new Date());
  if (data.remark !== undefined && data.remark !== '') changes.Remark = data.remark;

  updateRow('SortingLog', 'JobID', jobId, changes);

  // Keep ProductionLog totals correct for this round's increment
  var adj = postSortingProductionAdjustment(user, job, goodInc, lugInc, screwInc, screwLugInc);

  return {
    success: true,
    status: newStatus,
    productionAdjusted: adj.adjusted,
    totals: { good: newGood, defect: newDefect, lug: newLug, screw: newScrew, screwLug: newScrewLug },
    message: (newStatus === 'completed'
      ? 'บันทึกผลคัดแยกเรียบร้อย - งานเสร็จสมบูรณ์'
      : 'บันทึกผลคัดแยกเรียบร้อย - บวกยอดสะสมแล้ว')
      + (adj.adjusted ? ' (ปรับยอดผลิตแล้ว)' : '')
  };
}

/**
 * Post a ProductionLog adjustment row for one sorting round.
 * - FG-found jobs: good is already counted, so only reclassify the defects found
 *   (ActualQty -= defect, DefectQty += defect).
 * - Other sources (กล่องเหลือง / ไลน์ผลิต / QC): recovered pieces were not counted yet,
 *   so add good as output (ActualQty += good) and add the defect (DefectQty += defect).
 * The row is tagged with Status 'sort-adjust' and the source JobID for audit.
 */
function postSortingProductionAdjustment(user, job, goodInc, lugInc, screwInc, screwLugInc) {
  var defectInc = lugInc + screwInc + screwLugInc;
  var isFG = String(job.FoundProcess || '').toUpperCase() === 'FG';

  var actualDelta = isFG ? -defectInc : goodInc;
  var defectDelta = defectInc;
  if (actualDelta === 0 && defectDelta === 0) return { adjusted: false };

  ensureColumnExists('ProductionLog', 'DefectDetails');
  var now = new Date();
  var detailParts = [];
  if (lugInc) detailParts.push('Lug: ' + lugInc);
  if (screwInc) detailParts.push('Screw: ' + screwInc);
  if (screwLugInc) detailParts.push('Screw+Lug: ' + screwLugInc);

  appendRow('ProductionLog', {
    LogID: 'STADJ-' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase(),
    Timestamp: formatDate(now),
    Date: job.Date || getWorkDate(now),
    Shift: job.Shift || user.shift || '',
    TimePeriod: '',
    EmployeeID: user.employeeId,
    EmployeeName: user.name,
    MachineID: job.MachineID || '',
    ProductCode: job.ProductCode || '',
    PlannedQty: 0,
    ActualQty: actualDelta,
    DefectQty: defectDelta,
    DefectDetails: detailParts.join(', '),
    Remark: 'ปรับยอดจากการคัดแยก ' + job.JobID + ' (' + (job.FoundProcess || '') + ')',
    Status: 'sort-adjust'
  });

  return { adjusted: true, actualDelta: actualDelta, defectDelta: defectDelta };
}

function getSortingJobs(token, filters) {
  var user = validateSession(token);
  if (!user) return [];

  ensureSheetExists('SortingLog', SORTING_HEADERS);
  var jobs = getAllRows('SortingLog');

  if (filters) {
    if (filters.status) {
      jobs = jobs.filter(function(r) { return r.Status === filters.status; });
    }
    if (filters.dateFrom && filters.dateTo) {
      jobs = jobs.filter(function(r) {
        return r.Date >= filters.dateFrom && r.Date <= filters.dateTo;
      });
    }
    if (filters.machineId) {
      jobs = jobs.filter(function(r) { return r.MachineID === filters.machineId; });
    }
    if (filters.date) {
      jobs = jobs.filter(function(r) { return r.Date === filters.date; });
    }
  }

  jobs.sort(function(a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); });
  return jobs;
}

function getTodaySortingJobs(token) {
  var user = validateSession(token);
  if (!user) return [];

  ensureSheetExists('SortingLog', SORTING_HEADERS);
  var today = getWorkDate(new Date());
  var jobs = findRows('SortingLog', function(r) { return r.Date === today; });
  jobs.sort(function(a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); });
  return jobs;
}

function getSortingDashboard(token, filters) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  ensureSheetExists('SortingLog', SORTING_HEADERS);
  var jobs = getAllRows('SortingLog');

  if (filters) {
    if (filters.dateFrom && filters.dateTo) {
      jobs = jobs.filter(function(r) {
        return r.Date >= filters.dateFrom && r.Date <= filters.dateTo;
      });
    }
    if (filters.machineId) {
      jobs = jobs.filter(function(r) { return r.MachineID === filters.machineId; });
    }
  }

  var totalJobs = jobs.length;
  var pendingJobs = 0;
  var inProgressJobs = 0;
  var completedJobs = 0;
  var totalQtyAll = 0;
  var totalGood = 0;
  var totalDefect = 0;
  var totalSorted = 0;
  var totalLug = 0;
  var totalScrew = 0;
  var totalScrewLug = 0;

  var byMachine = {};
  var byProcess = {};

  for (var i = 0; i < jobs.length; i++) {
    var j = jobs[i];
    var qty = Number(j.TotalQty) || 0;
    var good = Number(j.GoodQty) || 0;
    var defect = Number(j.DefectQty) || 0;
    var lug = Number(j.DefectLug) || 0;
    var screw = Number(j.DefectScrew) || 0;
    var screwLug = Number(j.DefectScrewLug) || 0;

    totalQtyAll += qty;
    totalGood += good;
    totalDefect += defect;
    totalSorted += (good + defect);
    totalLug += lug;
    totalScrew += screw;
    totalScrewLug += screwLug;

    if (j.Status === 'pending') pendingJobs++;
    else if (j.Status === 'in-progress') inProgressJobs++;
    else if (j.Status === 'completed') completedJobs++;

    // By machine
    var mid = j.MachineID || 'unknown';
    if (!byMachine[mid]) byMachine[mid] = { total: 0, good: 0, defect: 0, lug: 0, screw: 0, screwLug: 0, jobs: 0 };
    byMachine[mid].total += qty;
    byMachine[mid].good += good;
    byMachine[mid].defect += defect;
    byMachine[mid].lug += lug;
    byMachine[mid].screw += screw;
    byMachine[mid].screwLug += screwLug;
    byMachine[mid].jobs++;

    // By process
    var proc = j.FoundProcess || 'unknown';
    if (!byProcess[proc]) byProcess[proc] = { total: 0, good: 0, defect: 0, lug: 0, screw: 0, screwLug: 0, jobs: 0 };
    byProcess[proc].total += qty;
    byProcess[proc].good += good;
    byProcess[proc].defect += defect;
    byProcess[proc].lug += lug;
    byProcess[proc].screw += screw;
    byProcess[proc].screwLug += screwLug;
    byProcess[proc].jobs++;
  }

  return {
    success: true,
    summary: {
      totalJobs: totalJobs,
      pendingJobs: pendingJobs,
      inProgressJobs: inProgressJobs,
      completedJobs: completedJobs,
      totalQty: totalQtyAll,
      totalSorted: totalSorted,
      totalGood: totalGood,
      totalDefect: totalDefect,
      defectLug: totalLug,
      defectScrew: totalScrew,
      defectScrewLug: totalScrewLug,
      defectRate: totalSorted > 0 ? ((totalDefect / totalSorted) * 100).toFixed(2) : '0.00',
      goodRate: totalSorted > 0 ? ((totalGood / totalSorted) * 100).toFixed(2) : '0.00'
    },
    byMachine: byMachine,
    byProcess: byProcess
  };
}
