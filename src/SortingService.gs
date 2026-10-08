/**
 * Sorting Job Management Service
 * จัดการงานคัดแยก (Sort) สำหรับ Lug & Screw
 */

var SORTING_HEADERS = ['JobID', 'Timestamp', 'Date', 'Shift', 'ShiftDN', 'MachineID', 'ProductCode', 'FoundProcess', 'TotalQty', 'GoodQty', 'DefectQty', 'DefectLug', 'DefectScrew', 'DefectScrewLug', 'Status', 'RegisteredBy', 'RegisteredByName', 'SortedBy', 'SortedByName', 'PulledAt', 'CompletedAt', 'Remark', 'JobOrderID', 'ShortClosedAt', 'ShortClosedBy', 'ShortClosedByName', 'ShortCloseReason'];

function ensureSortingColumns() {
  // Self-heal: create the SortingLog sheet if it was never set up by initializeSystem()
  ensureSheetExists('SortingLog', SORTING_HEADERS);
  ensureColumnExists('SortingLog', 'DefectLug');
  ensureColumnExists('SortingLog', 'DefectScrew');
  ensureColumnExists('SortingLog', 'DefectScrewLug');
  ensureColumnExists('SortingLog', 'SortedBy');
  ensureColumnExists('SortingLog', 'SortedByName');
  ensureColumnExists('SortingLog', 'PulledAt');
  ensureColumnExists('SortingLog', 'JobOrderID');
  ensureColumnExists('SortingLog', 'ShortClosedAt');
  ensureColumnExists('SortingLog', 'ShortClosedBy');
  ensureColumnExists('SortingLog', 'ShortClosedByName');
  ensureColumnExists('SortingLog', 'ShortCloseReason');
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

  var jobOrderCheck = validateJobOrderForEntry(data.jobOrderId, data.machineId, data.productCode);
  if (!jobOrderCheck.valid) return { success: false, message: jobOrderCheck.message };

  ensureSortingColumns();
  var now = new Date();
  // Sorting work is often registered after the fact — the bags are found on the
  // line one day and logged the next — so the caller may name the work date the
  // job belongs to. Same contract as submitProduction: an unparseable or missing
  // date falls back to the current work date rather than rejecting the entry.
  var workDate = data.workDate ? String(data.workDate) : getWorkDate(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    workDate = getWorkDate(now);
  }
  // The JobID carries the work date, not the moment of typing, so a backdated job
  // still reads as belonging to the day it happened.
  var jobId = 'ST-' + workDate.replace(/-/g, '') + '-' + generateUUID().substring(0, 6).toUpperCase();
  var shiftDN = detectShift(now);

  appendRow('SortingLog', {
    JobID: jobId,
    Timestamp: formatDate(now),
    Date: workDate,
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
    Remark: data.remark || '',
    JobOrderID: jobOrderCheck.jobOrderId
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
  var openRounds = getSortingRoundsMode(user) !== 'off' ? findRows('SortingRounds', function(r) {
    return String(r.Status) === 'open' && String(r.JobID) === String(jobId);
  }) : [];
  if (openRounds.length) {
    return { success: false, message: 'งานนี้มีรอบที่กำลังคัดอยู่ — กรุณาหยุดรอบก่อนคืนงาน' };
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
 * Close jobs that are finished on the floor but short of their registered quantity
 * (pieces lost, or counted high at registration), so they stop showing as being sorted.
 * Needs the sortingClose permission. The sorted totals stay as they are and nothing is posted to
 * ProductionLog; who closed it, when and why are kept on the job, and the shortfall is
 * what is left of TotalQty. data: { jobIds: [...], reason }.
 */
var SORTING_SHORT_CLOSE_REASONS = ['ของหมดแล้ว', 'นับเกินตอนลงทะเบียน', 'ลงทะเบียนผิด/ซ้ำ', 'อื่นๆ'];

// Granted by the sortingClose permission: on for supervisors and admins by default,
// and an admin can grant it to anyone else on the user's permissions.
function canCloseSortingJobs(user) {
  return !!(user && user.permissions && user.permissions.sortingClose);
}

function closeSortingJobs(token, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canCloseSortingJobs(user)) return { success: false, message: 'ไม่มีสิทธิ์ปิดงาน Sort' };

  data = data || {};
  var ids = Array.isArray(data.jobIds) ? data.jobIds : (data.jobId ? [data.jobId] : []);
  ids = ids.map(String).filter(function(id, i, a) { return id && a.indexOf(id) === i; });
  if (!ids.length) return { success: false, message: 'ไม่ได้เลือกงาน' };
  var reason = String(data.reason || '').trim();
  if (!reason) return { success: false, message: 'กรุณาระบุเหตุผล' };

  ensureSortingColumns();
  var wanted = {};
  ids.forEach(function(id) { wanted[id] = true; });
  var jobs = {};
  getAllRows('SortingLog').forEach(function(j) { if (wanted[String(j.JobID)]) jobs[String(j.JobID)] = j; });
  var openByJob = {};
  ensureSortingRoundSheets();
  getAllRows('SortingRounds').forEach(function(r) {
    if (String(r.Status) === 'open') openByJob[String(r.JobID)] = r;
  });

  var now = formatDate(new Date());
  var closed = [], skipped = [], updates = {};
  ids.forEach(function(id) {
    var job = jobs[id];
    if (!job) { skipped.push(id + ' (ไม่พบงาน)'); return; }
    if (String(job.Status) === 'completed') { skipped.push(id + ' (เสร็จแล้ว)'); return; }
    var open = openByJob[id];
    if (open) { skipped.push(id + ' (' + (open.EmployeeName || open.EmployeeID) + ' กำลังคัดอยู่)'); return; }
    var sorted = (Number(job.GoodQty) || 0) + (Number(job.DefectQty) || 0);
    updates[id] = {
      Status: 'completed',
      CompletedAt: now,
      ShortClosedAt: now,
      ShortClosedBy: user.employeeId,
      ShortClosedByName: user.name,
      ShortCloseReason: reason
    };
    closed.push({ jobId: id, shortQty: Math.max(0, (Number(job.TotalQty) || 0) - sorted) });
  });
  // One pass over the sheet: closing dozens of jobs row by row ran past the page's timeout.
  if (closed.length) updateRows('SortingLog', 'JobID', updates);

  var msg = closed.length ? 'ปิดงานแล้ว ' + closed.length + ' งาน' : 'ไม่ได้ปิดงานใด';
  if (skipped.length) msg += ' · ข้าม ' + skipped.length + ': ' + skipped.join(', ');
  return { success: closed.length > 0, message: msg, closed: closed, skipped: skipped };
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
 * Record a sorting result without the round timer (back-filling a round that was
 * sorted but never started on the page). Quantities are INCREMENTS that accumulate
 * onto the job's running totals. The result is still logged as a SortingRounds row,
 * flagged 'manual', so it counts toward the sorter's pieces but not toward pieces per
 * hour (there is no sorting time behind it).
 */
function recordSortingResult(token, jobId, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  ensureSortingColumns();
  var job = findRow('SortingLog', 'JobID', jobId);
  if (!job) return { success: false, message: 'ไม่พบงาน sort: ' + jobId };

  var inc = readSortingIncrement(data);
  if (inc.error) return { success: false, message: inc.error };
  if (inc.good === 0 && inc.defect === 0) {
    return { success: false, message: 'กรุณากรอกจำนวนอย่างน้อย 1 ช่อง' };
  }

  var mode = getSortingRoundsModeForJob(user, job);
  var applied = applySortingIncrement(user, job, inc, data.remark,
    { keepFirstSorter: mode === 'off', skipProduction: mode === 'test' });

  // Before rounds go live this is the original flow: job totals only, no round row.
  if (mode === 'off') return sortingResultResponse(applied);

  ensureSortingRoundSheets();
  var now = new Date();
  var stamp = formatDate(now);
  appendRow('SortingRounds', {
    RoundID: newSortingRoundId(now),
    Timestamp: stamp,
    WorkDate: getWorkDate(now),
    Shift: (data && data.shift) || user.shift || job.Shift || '',
    ShiftDN: detectShift(now),
    JobID: job.JobID,
    EmployeeID: user.employeeId,
    EmployeeName: user.name,
    StartAt: stamp,
    EndAt: stamp,
    Minutes: '',
    GoodQty: inc.good,
    DefectLug: inc.lug,
    DefectScrew: inc.screw,
    DefectScrewLug: inc.screwLug,
    ProductCode: job.ProductCode || '',
    MachineID: job.MachineID || '',
    FoundProcess: job.FoundProcess || '',
    StopReason: applied.status === 'completed' ? 'done' : '',
    Flag: mode === 'test' ? 'manual,test' : 'manual',
    Status: 'closed',
    ProdAdjLogID: applied.adj.logId || '',
    Remark: (data && data.remark) || ''
  });

  return sortingResultResponse(applied);
}

function sortingResultResponse(applied) {
  return {
    success: true,
    status: applied.status,
    productionAdjusted: applied.adj.adjusted,
    totals: applied.totals,
    message: (applied.status === 'completed'
      ? 'บันทึกผลคัดแยกเรียบร้อย - งานเสร็จสมบูรณ์'
      : 'บันทึกผลคัดแยกเรียบร้อย - บวกยอดสะสมแล้ว')
      + (applied.adj.adjusted ? ' (ปรับยอดผลิตแล้ว)' : '')
  };
}

/**
 * Read one round's quantities off a request. Returns { good, lug, screw, screwLug,
 * defect } or { error } when a value is negative.
 */
function readSortingIncrement(data) {
  data = data || {};
  var inc = {
    good: Number(data.goodQty) || 0,
    lug: Number(data.defectLug) || 0,
    screw: Number(data.defectScrew) || 0,
    screwLug: Number(data.defectScrewLug) || 0
  };
  if (inc.good < 0 || inc.lug < 0 || inc.screw < 0 || inc.screwLug < 0) {
    return { error: 'จำนวนต้องไม่ติดลบ' };
  }
  inc.defect = inc.lug + inc.screw + inc.screwLug;
  return inc;
}

/**
 * Add one round's quantities onto the job's running totals and post the matching
 * ProductionLog adjustment. A negative increment (voiding a round) takes them back
 * off, and reopens a job that drops below its total again.
 * SortedBy always ends up as whoever sorted last; per-person credit lives in
 * SortingRounds, not here.
 * opts.keepFirstSorter restores the pre-rounds rule (SortedBy is only filled in when
 * empty) for while rounds are switched off; opts.skipProduction leaves ProductionLog
 * alone (an admin's test round).
 */
function applySortingIncrement(user, job, inc, remark, opts) {
  opts = opts || {};
  var newGood = (Number(job.GoodQty) || 0) + inc.good;
  var newDefect = (Number(job.DefectQty) || 0) + inc.defect;
  var newLug = (Number(job.DefectLug) || 0) + inc.lug;
  var newScrew = (Number(job.DefectScrew) || 0) + inc.screw;
  var newScrewLug = (Number(job.DefectScrewLug) || 0) + inc.screwLug;

  var totalQty = Number(job.TotalQty) || 0;
  var totalSorted = newGood + newDefect;
  // A job a supervisor closed short stays closed when a round is filled or voided later.
  var closedShort = String(job.Status) === 'completed' && !!job.ShortClosedAt;
  var newStatus = (closedShort || (totalQty > 0 && totalSorted >= totalQty)) ? 'completed' : 'in-progress';

  var now = formatDate(new Date());
  var changes = {
    GoodQty: newGood,
    DefectQty: newDefect,
    DefectLug: newLug,
    DefectScrew: newScrew,
    DefectScrewLug: newScrewLug,
    Status: newStatus
  };
  if ((inc.good > 0 || inc.defect > 0) && !(opts.keepFirstSorter && job.SortedBy)) {
    changes.SortedBy = user.employeeId;
    changes.SortedByName = user.name;
  }
  if (!job.PulledAt) changes.PulledAt = now;
  if (newStatus === 'completed' && String(job.Status) !== 'completed') changes.CompletedAt = now;
  if (newStatus !== 'completed') changes.CompletedAt = '';
  if (remark !== undefined && remark !== '') changes.Remark = remark;

  updateRow('SortingLog', 'JobID', job.JobID, changes);

  var adj = opts.skipProduction
    ? { adjusted: false }
    : postSortingProductionAdjustment(user, job, inc.good, inc.lug, inc.screw, inc.screwLug);

  return {
    status: newStatus,
    adj: adj,
    totals: { good: newGood, defect: newDefect, lug: newLug, screw: newScrew, screwLug: newScrewLug }
  };
}

/**
 * Post a ProductionLog adjustment row for one sorting round.
 * - FG-found jobs: good is already counted, so only reclassify the defects found
 *   (ActualQty -= defect, DefectQty += defect).
 * - Other sources (กล่องเหลือง / ไลน์ผลิต / QC): recovered pieces were not counted yet,
 *   so add good as output (ActualQty += good) and add the defect (DefectQty += defect).
 * The row is tagged with Status 'sort-adjust' and the source JobID for audit.
 * DefectDetails is written in the same { componentCode: { componentName, qty } }
 * shape production entries use, so exportQCDefectCSV itemizes and classifies it
 * (Lug / Screw / Lug+Screw) the same way instead of treating it as free text.
 */
function postSortingProductionAdjustment(user, job, goodInc, lugInc, screwInc, screwLugInc) {
  var defectInc = lugInc + screwInc + screwLugInc;
  var isFG = String(job.FoundProcess || '').toUpperCase() === 'FG';

  var actualDelta = isFG ? -defectInc : goodInc;
  var defectDelta = defectInc;
  if (actualDelta === 0 && defectDelta === 0) return { adjusted: false };

  ensureColumnExists('ProductionLog', 'DefectDetails');
  var now = new Date();
  var defectDetails = {};
  if (lugInc) defectDetails.LUG = { componentName: 'Lug', qty: lugInc };
  if (screwInc) defectDetails.SCREW = { componentName: 'Screw', qty: screwInc };
  if (screwLugInc) defectDetails.SCREWLUG = { componentName: 'Screw+Lug', qty: screwLugInc };

  var logId = 'STADJ-' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase();
  appendRow('ProductionLog', {
    LogID: logId,
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
    DefectDetails: Object.keys(defectDetails).length ? JSON.stringify(defectDetails) : '',
    Remark: 'ปรับยอดจากการคัดแยก ' + job.JobID + ' (' + (job.FoundProcess || '') + ')',
    Status: 'sort-adjust',
    JobOrderID: job.JobOrderID || ''
  });

  return { adjusted: true, logId: logId, actualDelta: actualDelta, defectDelta: defectDelta };
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
    if (filters.jobOrderId) {
      jobs = jobs.filter(function(r) { return String(r.JobOrderID || '') === String(filters.jobOrderId); });
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
  // Show pending/in-progress from any date (carry-over jobs) + completed only from today
  var jobs = findRows('SortingLog', function(r) {
    var st = String(r.Status || '');
    if (st === 'pending' || st === 'in-progress') return true;
    return r.Date === today;
  });
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
    if (filters.jobOrderId && filters.jobOrderId !== 'all') {
      jobs = jobs.filter(function(r) { return String(r.JobOrderID || '') === String(filters.jobOrderId); });
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
  var byJobOrder = {};

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

    // By Job Order. Keep unassigned legacy sorting jobs visible under one bucket.
    var jobOrderId = j.JobOrderID || 'ไม่ระบุ';
    if (!byJobOrder[jobOrderId]) byJobOrder[jobOrderId] = { total: 0, good: 0, defect: 0, lug: 0, screw: 0, screwLug: 0, jobs: 0 };
    byJobOrder[jobOrderId].total += qty;
    byJobOrder[jobOrderId].good += good;
    byJobOrder[jobOrderId].defect += defect;
    byJobOrder[jobOrderId].lug += lug;
    byJobOrder[jobOrderId].screw += screw;
    byJobOrder[jobOrderId].screwLug += screwLug;
    byJobOrder[jobOrderId].jobs++;
  }

  // NG is counted per part, like the production dashboard (see partNgRates): a
  // Screw+Lug piece is 1 broken Lug and 1 broken Screw, a good set is 1 of each.
  var partRates = partNgRates(totalGood, totalLug + totalScrewLug, totalScrew + totalScrewLug);

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
      defectRate: totalSorted > 0 ? partRates.rate.toFixed(2) : '0.00',
      goodRate: totalSorted > 0 ? (100 - partRates.rate).toFixed(2) : '0.00',
      lugRate: partRates.lugRate,
      screwRate: partRates.screwRate
    },
    byMachine: byMachine,
    byProcess: byProcess,
    byJobOrder: byJobOrder
  };
}
