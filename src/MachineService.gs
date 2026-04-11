/**
 * Machine Management Service
 */

function getMachines() {
  ensureColumnExists('Machines', 'Capacity');
  var machines = getAllRows('Machines');
  return machines.map(function(m) {
    return {
      machineId: m.MachineID,
      machineName: m.MachineName,
      line: m.Line,
      status: m.Status,
      assignedProducts: m.AssignedProducts ? String(m.AssignedProducts).split(',').map(function(s) { return s.trim(); }) : [],
      currentProduct: m.CurrentProduct ? String(m.CurrentProduct).trim() : '',
      capacity: Number(m.Capacity) || 0
    };
  });
}

function getMachineProducts(machineId) {
  var machine = findRow('Machines', 'MachineID', machineId);
  if (!machine) return [];

  var assignedStr = machine.AssignedProducts ? String(machine.AssignedProducts).trim() : '';
  if (!assignedStr) return [];

  var productCodes = assignedStr.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
  if (productCodes.length === 0) return [];

  var allProducts = getAllRows('Products');

  var matched = allProducts.filter(function(p) {
    return productCodes.indexOf(p.ProductCode) !== -1 && isActiveValue(p.Active);
  }).map(function(p) {
    return {
      productCode: p.ProductCode,
      productName: p.ProductName,
      defaultQty: p.DefaultQty || 1300
    };
  });

  // Fallback: if Products table has no matching entries, create entries from assigned codes
  if (matched.length === 0) {
    matched = productCodes.map(function(code) {
      return {
        productCode: code,
        productName: code,
        defaultQty: 1300
      };
    });
  }

  return matched;
}

function updateMachineStatus(machineId, status) {
  return updateRow('Machines', 'MachineID', machineId, { Status: status });
}

function updateMachineCapacity(token, machineId, capacity) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }
  if (!hasRole(token, 'admin')) {
    return { success: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  }

  ensureColumnExists('Machines', 'Capacity');
  var cap = Number(capacity);
  if (isNaN(cap) || cap < 0) {
    return { success: false, message: 'Capacity ไม่ถูกต้อง' };
  }
  var ok = updateRow('Machines', 'MachineID', machineId, { Capacity: cap });
  return { success: ok };
}

function setCurrentProduct(token, machineId, productCode) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }

  var machine = findRow('Machines', 'MachineID', machineId);
  if (!machine) {
    return { success: false, message: 'ไม่พบเครื่องจักร' };
  }

  // Validate productCode is in assignedProducts (or allow clearing with empty string)
  if (productCode) {
    var assigned = machine.AssignedProducts ? String(machine.AssignedProducts).split(',').map(function(s) { return s.trim(); }) : [];
    if (assigned.indexOf(productCode) === -1) {
      return { success: false, message: 'สินค้านี้ไม่ได้กำหนดให้เครื่องนี้' };
    }
  }

  updateRow('Machines', 'MachineID', machineId, { CurrentProduct: productCode || '' });
  return { success: true, message: 'บันทึกสินค้าที่กำลังผลิต: ' + (productCode || '(ว่าง)') };
}

function assignProductToMachine(token, machineId, productCode) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }
  if (!hasRole(token, 'supervisor')) {
    return { success: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  }

  var machine = findRow('Machines', 'MachineID', machineId);
  if (!machine) {
    return { success: false, message: 'ไม่พบเครื่องจักร' };
  }

  var currentProducts = machine.AssignedProducts ? String(machine.AssignedProducts).split(',').map(function(s) { return s.trim(); }) : [];

  if (currentProducts.indexOf(productCode) === -1) {
    currentProducts.push(productCode);
    updateRow('Machines', 'MachineID', machineId, {
      AssignedProducts: currentProducts.join(', ')
    });
  }

  return { success: true };
}

function removeProductFromMachine(token, machineId, productCode) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }
  if (!hasRole(token, 'supervisor')) {
    return { success: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  }

  var machine = findRow('Machines', 'MachineID', machineId);
  if (!machine) {
    return { success: false, message: 'ไม่พบเครื่องจักร' };
  }

  var currentProducts = String(machine.AssignedProducts).split(',').map(function(s) { return s.trim(); });
  currentProducts = currentProducts.filter(function(p) { return p !== productCode; });

  var updates = { AssignedProducts: currentProducts.join(', ') };
  // If removing the current product, clear it
  if (String(machine.CurrentProduct).trim() === productCode) {
    updates.CurrentProduct = '';
  }

  updateRow('Machines', 'MachineID', machineId, updates);
  return { success: true };
}

function getMachineWithStats(machineId) {
  var machine = findRow('Machines', 'MachineID', machineId);
  if (!machine) return null;

  var today = getWorkDate(new Date());
  var todayLogs = findRows('ProductionLog', function(row) {
    return row.MachineID === machineId &&
           row.Date === today &&
           row.Status !== 'cancelled';
  });

  var totalOutput = todayLogs.reduce(function(sum, log) {
    return sum + (Number(log.ActualQty) || 0);
  }, 0);

  var openTickets = findRows('MaintenanceLog', function(row) {
    return row.MachineID === machineId &&
           (row.Status === 'open' || row.Status === 'in-progress');
  });

  return {
    machineId: machine.MachineID,
    machineName: machine.MachineName,
    line: machine.Line,
    status: machine.Status,
    assignedProducts: machine.AssignedProducts,
    currentProduct: machine.CurrentProduct ? String(machine.CurrentProduct).trim() : '',
    todayOutput: totalOutput,
    todayEntries: todayLogs.length,
    openTickets: openTickets.length
  };
}
