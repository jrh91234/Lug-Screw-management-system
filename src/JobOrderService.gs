/**
 * Job Order Management Service
 *
 * A Job Order is the common production reference shared by production entries,
 * sorting jobs and dashboard summaries. Existing rows remain valid because the
 * JobOrderID column is optional for historical data.
 */

var JOB_ORDER_HEADERS = [
  'JobOrderID', 'CreatedAt', 'CreatedBy', 'CreatedByName',
  'WorkDate', 'DueDate', 'MachineID', 'ProductCode', 'Shift', 'PlannedQty',
  'Priority', 'Status', 'Remark'
];

var JOB_ORDER_ACTIVE_STATUSES = ['open', 'in-progress'];
var JOB_ORDER_STATUSES = ['open', 'in-progress', 'completed', 'cancelled'];

function ensureJobOrderSheet() {
  var sheet = ensureSheetExists('JobOrders', JOB_ORDER_HEADERS);
  // Keep deployments made before Job Order existed self-healing if an operator
  // created a partial sheet manually.
  JOB_ORDER_HEADERS.forEach(function(header) {
    ensureColumnExists('JobOrders', header);
  });
  return sheet;
}

function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isJobOrderActiveStatus(status) {
  return JOB_ORDER_ACTIVE_STATUSES.indexOf(String(status || '').toLowerCase()) !== -1;
}

function mapJobOrderRow(row) {
  return {
    jobOrderId: String(row.JobOrderID || ''),
    createdAt: row.CreatedAt || '',
    createdBy: row.CreatedBy || '',
    createdByName: row.CreatedByName || '',
    workDate: String(row.WorkDate || ''),
    dueDate: String(row.DueDate || ''),
    machineId: String(row.MachineID || ''),
    productCode: String(row.ProductCode || ''),
    shift: String(row.Shift || 'all'),
    plannedQty: Number(row.PlannedQty) || 0,
    priority: String(row.Priority || 'normal'),
    status: String(row.Status || 'open').toLowerCase(),
    remark: String(row.Remark || '')
  };
}

function filterJobOrderRows(rows, filters, includeAllStatuses) {
  filters = filters || {};
  var includeAll = includeAllStatuses || filters.includeAll === true || String(filters.includeAll).toLowerCase() === 'true';
  var requestedStatus = String(filters.status || '').toLowerCase();

  return rows.filter(function(row) {
    var status = String(row.Status || 'open').toLowerCase();
    if (requestedStatus && requestedStatus !== 'all' && status !== requestedStatus) return false;
    if (!requestedStatus && !includeAll && !isJobOrderActiveStatus(status)) return false;
    if (filters.machineId && String(row.MachineID || '') !== String(filters.machineId)) return false;
    if (filters.productCode && String(row.ProductCode || '') !== String(filters.productCode)) return false;
    if (filters.shift && String(filters.shift).toLowerCase() !== 'all' &&
        String(row.Shift || 'all').toLowerCase() !== String(filters.shift).toLowerCase()) return false;
    if (filters.workDate && String(row.WorkDate || '') !== String(filters.workDate)) return false;
    if (filters.dateFrom && String(row.WorkDate || '') < String(filters.dateFrom)) return false;
    if (filters.dateTo && String(row.WorkDate || '') > String(filters.dateTo)) return false;
    return true;
  });
}

function sortJobOrderRows(a, b) {
  var workDiff = String(b.WorkDate || '').localeCompare(String(a.WorkDate || ''));
  if (workDiff !== 0) return workDiff;
  return new Date(b.CreatedAt || 0) - new Date(a.CreatedAt || 0);
}

/**
 * Lightweight options for production/sorting forms. This intentionally does not
 * read the large log sheets; operators only need the order master fields here.
 */
function getJobOrderOptions(token, filters) {
  if (!validateSession(token)) return [];

  ensureJobOrderSheet();
  var rows = filterJobOrderRows(getAllRows('JobOrders'), filters, false);
  rows.sort(sortJobOrderRows);
  return rows.map(mapJobOrderRow);
}

function validateJobOrderForEntry(jobOrderId, machineId, productCode) {
  var id = String(jobOrderId || '').trim();
  if (!id) return { valid: true, jobOrderId: '' };

  ensureJobOrderSheet();
  var row = findRow('JobOrders', 'JobOrderID', id);
  if (!row) return { valid: false, message: 'ไม่พบ Job Order: ' + id };
  if (!isJobOrderActiveStatus(row.Status)) {
    return { valid: false, message: 'Job Order นี้ไม่อยู่ในสถานะที่ลงงานได้' };
  }
  if (String(row.MachineID || '') !== String(machineId || '')) {
    return { valid: false, message: 'Job Order นี้อยู่คนละเครื่องจักร' };
  }
  if (String(row.ProductCode || '') !== String(productCode || '')) {
    return { valid: false, message: 'Job Order นี้เป็นคนละสินค้า' };
  }
  return { valid: true, jobOrderId: id, row: row };
}

function canManageJobOrders(token) {
  var user = validateSession(token);
  if (!user) return { user: null, error: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!hasRole(token, 'supervisor')) return { user: null, error: 'ไม่มีสิทธิ์จัดการ Job Order' };
  return { user: user, error: '' };
}

function createJobOrder(token, data) {
  var access = canManageJobOrders(token);
  if (!access.user) return { success: false, message: access.error };
  data = data || {};

  var machineId = String(data.machineId || '').trim();
  var productCode = String(data.productCode || '').trim();
  var shift = String(data.shift || 'all').trim().toUpperCase();
  var workDate = String(data.workDate || '').trim();
  var dueDate = String(data.dueDate || '').trim();
  var plannedQty = Number(data.plannedQty);
  var priority = String(data.priority || 'normal').toLowerCase();

  if (!machineId || !productCode) return { success: false, message: 'กรุณาเลือกเครื่องจักรและสินค้า' };
  if (!isValidIsoDate(workDate)) return { success: false, message: 'วันที่งานไม่ถูกต้อง' };
  if (dueDate && !isValidIsoDate(dueDate)) return { success: false, message: 'กำหนดส่งไม่ถูกต้อง' };
  if (dueDate && dueDate < workDate) return { success: false, message: 'กำหนดส่งต้องไม่ก่อนวันที่งาน' };
  if (isNaN(plannedQty) || plannedQty <= 0) return { success: false, message: 'จำนวนแผนต้องมากกว่า 0' };
  if (['A', 'B', 'ALL'].indexOf(shift) === -1) shift = 'ALL';
  if (['low', 'normal', 'high', 'urgent'].indexOf(priority) === -1) priority = 'normal';

  var machine = findRow('Machines', 'MachineID', machineId);
  if (!machine) return { success: false, message: 'ไม่พบเครื่องจักร' };

  var assigned = machine.AssignedProducts ? String(machine.AssignedProducts).split(',').map(function(code) {
    return code.trim();
  }) : [];
  if (assigned.length && assigned.indexOf(productCode) === -1) {
    return { success: false, message: 'สินค้านี้ไม่ได้กำหนดให้เครื่องจักรนี้' };
  }

  var product = findRow('Products', 'ProductCode', productCode);
  if (!product || !isActiveValue(product.Active)) {
    return { success: false, message: 'ไม่พบสินค้าที่เปิดใช้งาน' };
  }

  ensureJobOrderSheet();
  var requestedJobOrderId = String(data.jobOrderId || '').trim();
  var jobOrderId = requestedJobOrderId;
  if (requestedJobOrderId) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/.test(requestedJobOrderId)) {
      return { success: false, message: 'เลข Job Order ใช้ได้เฉพาะ A-Z, 0-9, _ และ - (3-40 ตัวอักษร)' };
    }
    if (findRow('JobOrders', 'JobOrderID', requestedJobOrderId)) {
      return { success: false, message: 'เลข Job Order นี้มีอยู่แล้ว' };
    }
  } else {
    jobOrderId = 'JO-' + workDate.replace(/-/g, '') + '-' + generateUUID().substring(0, 6).toUpperCase();
  }
  var now = new Date();
  appendRow('JobOrders', {
    JobOrderID: jobOrderId,
    CreatedAt: formatDate(now),
    CreatedBy: access.user.employeeId,
    CreatedByName: access.user.name,
    WorkDate: workDate,
    DueDate: dueDate || workDate,
    MachineID: machineId,
    ProductCode: productCode,
    Shift: shift,
    PlannedQty: plannedQty,
    Priority: priority,
    Status: 'open',
    Remark: String(data.remark || '')
  });

  writeActionLog(access.user.employeeId, access.user.name, 'create_job_order', {
    jobOrderId: jobOrderId,
    machineId: machineId,
    productCode: productCode,
    plannedQty: plannedQty
  });
  return { success: true, jobOrderId: jobOrderId, message: 'สร้าง Job Order สำเร็จ: ' + jobOrderId };
}

function updateJobOrder(token, jobOrderId, updates) {
  var access = canManageJobOrders(token);
  if (!access.user) return { success: false, message: access.error };

  jobOrderId = String(jobOrderId || '').trim();
  if (!jobOrderId) return { success: false, message: 'ไม่พบ Job Order' };
  ensureJobOrderSheet();
  var existing = findRow('JobOrders', 'JobOrderID', jobOrderId);
  if (!existing) return { success: false, message: 'ไม่พบ Job Order: ' + jobOrderId };

  updates = updates || {};
  var patch = {};
  if (updates.status !== undefined) {
    var status = String(updates.status || '').toLowerCase();
    if (JOB_ORDER_STATUSES.indexOf(status) === -1) return { success: false, message: 'สถานะ Job Order ไม่ถูกต้อง' };
    patch.Status = status;
  }
  if (updates.dueDate !== undefined) {
    var dueDate = String(updates.dueDate || '');
    if (!isValidIsoDate(dueDate) || dueDate < String(existing.WorkDate || '')) {
      return { success: false, message: 'กำหนดส่งไม่ถูกต้อง' };
    }
    patch.DueDate = dueDate;
  }
  if (updates.priority !== undefined) {
    var priority = String(updates.priority || 'normal').toLowerCase();
    if (['low', 'normal', 'high', 'urgent'].indexOf(priority) === -1) {
      return { success: false, message: 'ระดับความสำคัญไม่ถูกต้อง' };
    }
    patch.Priority = priority;
  }
  if (updates.remark !== undefined) patch.Remark = String(updates.remark || '');

  if (Object.keys(patch).length === 0) return { success: false, message: 'ไม่มีข้อมูลที่ต้องการแก้ไข' };
  updateRow('JobOrders', 'JobOrderID', jobOrderId, patch);
  writeActionLog(access.user.employeeId, access.user.name, 'update_job_order', {
    jobOrderId: jobOrderId,
    updates: patch
  });
  return { success: true, message: 'อัปเดต Job Order สำเร็จ' };
}

function makeJobOrderProgress(row) {
  var base = row ? mapJobOrderRow(row) : {};
  return {
    jobOrderId: base.jobOrderId || '',
    createdAt: base.createdAt || '',
    createdBy: base.createdBy || '',
    createdByName: base.createdByName || '',
    workDate: base.workDate || '',
    dueDate: base.dueDate || '',
    machineId: base.machineId || '',
    productCode: base.productCode || '',
    plannedQty: base.plannedQty || 0,
    priority: base.priority || 'normal',
    status: base.status || 'open',
    remark: base.remark || '',
    actualQty: 0,
    defectQty: 0,
    productionEntries: 0,
    sortingPlannedQty: 0,
    sortingQty: 0,
    sortingGoodQty: 0,
    sortingDefectQty: 0,
    sortingJobs: 0
  };
}

/** Build progress without writing totals back into the master sheet. */
function buildJobOrderProgress(jobRows, productionRows, sortingRows) {
  var byId = {};
  var masterById = {};

  (jobRows || []).forEach(function(row) {
    var id = String(row.JobOrderID || '').trim();
    if (!id) return;
    masterById[id] = row;
    byId[id] = makeJobOrderProgress(row);
  });

  function getOrCreate(id, source) {
    if (!byId[id]) {
      byId[id] = makeJobOrderProgress(masterById[id] || null);
      byId[id].jobOrderId = id;
      if (source) {
        byId[id].workDate = String(source.Date || source.WorkDate || '');
        byId[id].machineId = String(source.MachineID || '');
        byId[id].productCode = String(source.ProductCode || '');
      }
    }
    return byId[id];
  }

  (productionRows || []).forEach(function(row) {
    var id = String(row.JobOrderID || '').trim();
    if (!id || String(row.Status || '').toLowerCase() === 'cancelled') return;
    var progress = getOrCreate(id, row);
    progress.actualQty += Number(row.ActualQty) || 0;
    progress.defectQty += Number(row.DefectQty) || 0;
    progress.productionEntries++;
  });

  (sortingRows || []).forEach(function(row) {
    var id = String(row.JobOrderID || '').trim();
    if (!id) return;
    var progress = getOrCreate(id, row);
    progress.sortingPlannedQty += Number(row.TotalQty) || 0;
    progress.sortingGoodQty += Number(row.GoodQty) || 0;
    progress.sortingDefectQty += Number(row.DefectQty) || 0;
    progress.sortingQty += (Number(row.GoodQty) || 0) + (Number(row.DefectQty) || 0);
    progress.sortingJobs++;
  });

  return Object.keys(byId).map(function(id) {
    var progress = byId[id];
    progress.remainingQty = Math.max(0, progress.plannedQty - progress.actualQty);
    progress.completionRate = progress.plannedQty > 0
      ? Number(((progress.actualQty / progress.plannedQty) * 100).toFixed(1))
      : 0;
    return progress;
  });
}

function getJobOrders(token, filters) {
  var access = canManageJobOrders(token);
  if (!access.user) return { success: false, message: access.error };

  ensureJobOrderSheet();
  var rows = getAllRows('JobOrders');
  var filteredRows = filterJobOrderRows(rows, filters, true);
  var productionRows = getAllRows('ProductionLog');
  ensureSheetExists('SortingLog', ['JobID']);
  var sortingRows = getAllRows('SortingLog');
  var progress = buildJobOrderProgress(filteredRows, productionRows, sortingRows);
  progress.sort(function(a, b) {
    return String(b.workDate || '').localeCompare(String(a.workDate || '')) ||
      String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
  return progress;
}

/**
 * Dashboard join. Production rows are already filtered by date/shift/product;
 * SortingLog is scoped here so Job Order progress follows the same report range.
 */
function getJobOrderDashboardData(productionRows, dateFrom, dateTo, shiftABFilter, shiftDNFilter, productFilter, jobOrderFilter) {
  ensureJobOrderSheet();
  var jobRows = getAllRows('JobOrders');
  ensureSheetExists('SortingLog', ['JobID']);
  var sortingRows = getAllRows('SortingLog').filter(function(row) {
    if (String(row.Date || '') < String(dateFrom || '') || String(row.Date || '') > String(dateTo || '')) return false;
    if (shiftABFilter && shiftABFilter !== 'all' && String(row.Shift || '') !== String(shiftABFilter)) return false;
    if (shiftDNFilter && shiftDNFilter !== 'all') {
      var bucket = String(row.ShiftDN || '').toLowerCase();
      if (bucket !== String(shiftDNFilter).toLowerCase()) return false;
    }
    if (productFilter && productFilter !== 'all' && String(row.ProductCode || '') !== String(productFilter)) return false;
    if (jobOrderFilter && jobOrderFilter !== 'all' && String(row.JobOrderID || '') !== String(jobOrderFilter)) return false;
    return true;
  });

  if (jobOrderFilter && jobOrderFilter !== 'all') {
    jobRows = jobRows.filter(function(row) { return String(row.JobOrderID || '') === String(jobOrderFilter); });
  }
  if (productFilter && productFilter !== 'all') {
    jobRows = jobRows.filter(function(row) { return String(row.ProductCode || '') === String(productFilter); });
  }

  var progress = buildJobOrderProgress(jobRows, productionRows, sortingRows);
  return progress.filter(function(row) {
    if (jobOrderFilter && jobOrderFilter !== 'all') return row.jobOrderId === String(jobOrderFilter);
    var inWorkDate = row.workDate && row.workDate >= String(dateFrom || '') && row.workDate <= String(dateTo || '');
    return inWorkDate || row.actualQty !== 0 || row.sortingQty !== 0;
  });
}
