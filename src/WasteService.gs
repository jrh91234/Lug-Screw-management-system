/**
 * Waste Disposal Management Service
 */

function submitWaste(token, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  if (!data.wasteType) return { success: false, message: 'กรุณาเลือกชนิดขยะ' };
  var weight = Number(data.weightKg);
  if (!data.weightKg || isNaN(weight) || weight <= 0) {
    return { success: false, message: 'กรุณากรอกน้ำหนักที่ถูกต้อง' };
  }

  var now = data.recordedAt ? new Date(data.recordedAt) : new Date();
  var wasteId = 'WS-' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase();

  appendRow('WasteLog', {
    WasteID: wasteId,
    Timestamp: formatDate(now),
    Date: getWorkDate(now),
    RecordedBy: user.employeeId,
    RecorderName: user.name,
    WasteType: data.wasteType,
    WeightKg: weight,
    Remark: data.remark || ''
  });

  return { success: true, wasteId: wasteId, message: 'บันทึกข้อมูลขยะเรียบร้อย: ' + wasteId };
}

function getWasteTypes(token) {
  try {
    var rows = getAllRows('WasteTypes');
    return rows
      .filter(function(r) { return r.Active === '' || isActiveValue(r.Active); })
      .map(function(r) { return { typeId: r.TypeID, typeName: r.TypeName }; });
  } catch (e) {
    return [];
  }
}

function addWasteType(token, typeName) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  typeName = String(typeName || '').trim();
  if (!typeName) return { success: false, message: 'กรุณากรอกชื่อชนิดขยะ' };

  var existing = findRows('WasteTypes', function(r) {
    return r.TypeName === typeName && (r.Active === '' || isActiveValue(r.Active));
  });
  if (existing.length > 0) return { success: false, message: 'ชนิดขยะนี้มีอยู่แล้ว' };

  var typeId = 'WT-' + generateUUID().substring(0, 8).toUpperCase();
  appendRow('WasteTypes', {
    TypeID: typeId,
    TypeName: typeName,
    Active: true,
    CreatedAt: formatDate(new Date()),
    CreatedBy: user.employeeId
  });

  return { success: true, typeId: typeId, message: 'เพิ่มชนิดขยะสำเร็จ' };
}

function deleteWasteType(token, typeId) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  updateRow('WasteTypes', 'TypeID', typeId, { Active: false });
  return { success: true, message: 'ลบชนิดขยะสำเร็จ' };
}

function getTodayWaste(token) {
  var user = validateSession(token);
  if (!user) return [];

  var today = getWorkDate(new Date());
  var logs = findRows('WasteLog', function(r) { return r.Date === today; });
  logs.sort(function(a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); });
  return logs;
}

function getWasteHistory(token, filters) {
  var user = validateSession(token);
  if (!user) return [];

  var logs = getAllRows('WasteLog');

  if (filters) {
    if (filters.dateFrom && filters.dateTo) {
      logs = logs.filter(function(r) {
        return r.Date >= filters.dateFrom && r.Date <= filters.dateTo;
      });
    }
    if (filters.wasteType) {
      logs = logs.filter(function(r) { return r.WasteType === filters.wasteType; });
    }
  }

  logs.sort(function(a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); });
  return logs;
}
