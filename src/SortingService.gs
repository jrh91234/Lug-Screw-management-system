/**
 * Sorting Job Management Service
 * จัดการงานคัดแยก (Sort) สำหรับ Lug & Screw
 */

function submitSortingJob(token, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  if (!data.machineId) return { success: false, message: 'กรุณาเลือกเครื่องจักร' };
  if (!data.foundProcess) return { success: false, message: 'กรุณาเลือกกระบวนการที่พบ' };
  var totalQty = Number(data.totalQty);
  if (!data.totalQty || isNaN(totalQty) || totalQty <= 0) {
    return { success: false, message: 'กรุณากรอกจำนวนที่ต้อง sort' };
  }

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
    Status: 'pending',
    RegisteredBy: user.employeeId,
    RegisteredByName: user.name,
    CompletedAt: '',
    Remark: data.remark || ''
  });

  return { success: true, jobId: jobId, message: 'ลงทะเบียนงาน sort สำเร็จ: ' + jobId };
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

function recordSortingResult(token, jobId, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  var job = findRow('SortingLog', 'JobID', jobId);
  if (!job) return { success: false, message: 'ไม่พบงาน sort: ' + jobId };

  var goodQty = Number(data.goodQty);
  var defectQty = Number(data.defectQty);
  if (isNaN(goodQty) || goodQty < 0) return { success: false, message: 'จำนวนดีไม่ถูกต้อง' };
  if (isNaN(defectQty) || defectQty < 0) return { success: false, message: 'จำนวนเสียไม่ถูกต้อง' };

  var totalSorted = goodQty + defectQty;
  var totalQty = Number(job.TotalQty);
  var newStatus = totalSorted >= totalQty ? 'completed' : 'in-progress';

  var changes = {
    GoodQty: goodQty,
    DefectQty: defectQty,
    Status: newStatus
  };

  if (newStatus === 'completed') {
    changes.CompletedAt = formatDate(new Date());
  }

  if (data.remark !== undefined) {
    changes.Remark = data.remark;
  }

  updateRow('SortingLog', 'JobID', jobId, changes);

  return {
    success: true,
    message: newStatus === 'completed'
      ? 'บันทึกผลคัดแยกเรียบร้อย - งานเสร็จสมบูรณ์'
      : 'บันทึกผลคัดแยกเรียบร้อย - กำลังดำเนินการ',
    status: newStatus
  };
}

function getSortingJobs(token, filters) {
  var user = validateSession(token);
  if (!user) return [];

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

  var today = getWorkDate(new Date());
  var jobs = findRows('SortingLog', function(r) { return r.Date === today; });
  jobs.sort(function(a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); });
  return jobs;
}

function getSortingDashboard(token, filters) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

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

  var byMachine = {};
  var byProcess = {};

  for (var i = 0; i < jobs.length; i++) {
    var j = jobs[i];
    var qty = Number(j.TotalQty) || 0;
    var good = Number(j.GoodQty) || 0;
    var defect = Number(j.DefectQty) || 0;

    totalQtyAll += qty;
    totalGood += good;
    totalDefect += defect;
    totalSorted += (good + defect);

    if (j.Status === 'pending') pendingJobs++;
    else if (j.Status === 'in-progress') inProgressJobs++;
    else if (j.Status === 'completed') completedJobs++;

    // By machine
    var mid = j.MachineID || 'unknown';
    if (!byMachine[mid]) byMachine[mid] = { total: 0, good: 0, defect: 0, jobs: 0 };
    byMachine[mid].total += qty;
    byMachine[mid].good += good;
    byMachine[mid].defect += defect;
    byMachine[mid].jobs++;

    // By process
    var proc = j.FoundProcess || 'unknown';
    if (!byProcess[proc]) byProcess[proc] = { total: 0, good: 0, defect: 0, jobs: 0 };
    byProcess[proc].total += qty;
    byProcess[proc].good += good;
    byProcess[proc].defect += defect;
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
      defectRate: totalSorted > 0 ? ((totalDefect / totalSorted) * 100).toFixed(2) : '0.00',
      goodRate: totalSorted > 0 ? ((totalGood / totalSorted) * 100).toFixed(2) : '0.00'
    },
    byMachine: byMachine,
    byProcess: byProcess
  };
}
