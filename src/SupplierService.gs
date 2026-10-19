/**
 * Supplier master: who supplies the Lug and Screw parts loaded on a machine.
 * Managed on the admin page; the machines page picks from it and every production
 * entry records the machine's current Lug/Screw supplier.
 */

var SUPPLIER_HEADERS = ['SupplierID', 'SupplierName', 'PartType', 'Active', 'CreatedAt', 'CreatedBy'];
var SUPPLIER_PART_TYPES = ['lug', 'screw', 'both'];

function ensureSupplierSheet() {
  ensureSheetExists('Suppliers', SUPPLIER_HEADERS);
}

function isActiveSupplierRow(r) {
  return r.Active === '' || isActiveValue(r.Active);
}

function listActiveSuppliers() {
  ensureSupplierSheet();
  return getAllRows('Suppliers')
    .filter(function(r) { return String(r.SupplierName || '').trim() && isActiveSupplierRow(r); })
    .map(function(r) {
      var type = String(r.PartType || 'both').toLowerCase();
      return {
        supplierId: String(r.SupplierID || ''),
        supplierName: String(r.SupplierName).trim(),
        partType: SUPPLIER_PART_TYPES.indexOf(type) === -1 ? 'both' : type
      };
    })
    .sort(function(a, b) { return a.supplierName.localeCompare(b.supplierName); });
}

function getSuppliers(token) {
  if (!validateSession(token)) return [];
  return listActiveSuppliers();
}

/** { lug: [names], screw: [names] } — a 'both' supplier appears in each list. */
function getSupplierNameOptions() {
  var options = { lug: [], screw: [] };
  listActiveSuppliers().forEach(function(s) {
    if ((s.partType === 'lug' || s.partType === 'both') && options.lug.indexOf(s.supplierName) === -1) options.lug.push(s.supplierName);
    if ((s.partType === 'screw' || s.partType === 'both') && options.screw.indexOf(s.supplierName) === -1) options.screw.push(s.supplierName);
  });
  return options;
}

function addSupplier(token, supplierName, partType) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!hasRole(token, 'supervisor')) return { success: false, message: 'ไม่มีสิทธิ์จัดการ Supplier' };

  var name = String(supplierName || '').trim();
  var type = String(partType || '').toLowerCase();
  if (!name) return { success: false, message: 'กรุณากรอกชื่อ Supplier' };
  if (name.length > 80) return { success: false, message: 'ชื่อ Supplier ยาวเกินไป' };
  if (SUPPLIER_PART_TYPES.indexOf(type) === -1) return { success: false, message: 'กรุณาเลือกว่าส่ง Lug หรือ Screw' };

  ensureSupplierSheet();
  var duplicate = findRows('Suppliers', function(r) {
    return isActiveSupplierRow(r) && String(r.SupplierName || '').trim().toUpperCase() === name.toUpperCase();
  });
  if (duplicate.length) return { success: false, message: 'มี Supplier ชื่อนี้อยู่แล้ว' };

  var supplierId = 'SUP-' + generateUUID().substring(0, 8).toUpperCase();
  appendRow('Suppliers', {
    SupplierID: supplierId,
    SupplierName: name,
    PartType: type,
    Active: true,
    CreatedAt: formatDate(new Date()),
    CreatedBy: user.employeeId
  });
  writeActionLog(user.employeeId, user.name, 'add_supplier', { supplierId: supplierId, supplierName: name, partType: type });
  return { success: true, supplierId: supplierId, message: 'เพิ่ม Supplier สำเร็จ: ' + name };
}

function deleteSupplier(token, supplierId) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!hasRole(token, 'supervisor')) return { success: false, message: 'ไม่มีสิทธิ์จัดการ Supplier' };

  ensureSupplierSheet();
  var row = findRow('Suppliers', 'SupplierID', supplierId);
  if (!row) return { success: false, message: 'ไม่พบ Supplier' };
  // Soft delete: production entries keep the name they recorded.
  updateRow('Suppliers', 'SupplierID', supplierId, { Active: false });
  writeActionLog(user.employeeId, user.name, 'delete_supplier', { supplierId: supplierId, supplierName: row.SupplierName });
  return { success: true, message: 'ลบ Supplier แล้ว: ' + row.SupplierName };
}
