/**
 * Machine Management Service
 */

function getMachines() {
  var machines = getAllRows('Machines');
  return machines.map(function(m) {
    return {
      machineId: m.MachineID,
      machineName: m.MachineName,
      line: m.Line,
      status: m.Status,
      assignedProducts: m.AssignedProducts ? String(m.AssignedProducts).split(',').map(function(s) { return s.trim(); }) : []
    };
  });
}

function getMachineProducts(machineId) {
  var machine = findRow('Machines', 'MachineID', machineId);
  if (!machine) return [];

  var productCodes = String(machine.AssignedProducts).split(',').map(function(s) { return s.trim(); });
  var allProducts = getAllRows('Products');

  return allProducts.filter(function(p) {
    return productCodes.indexOf(p.ProductCode) !== -1 && (String(p.Active) === 'TRUE' || p.Active === true);
  }).map(function(p) {
    return {
      productCode: p.ProductCode,
      productName: p.ProductName,
      defaultQty: p.DefaultQty || 1300
    };
  });
}

function updateMachineStatus(machineId, status) {
  return updateRow('Machines', 'MachineID', machineId, { Status: status });
}

function assignProductToMachine(token, machineId, productCode) {
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
  if (!hasRole(token, 'supervisor')) {
    return { success: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  }

  var machine = findRow('Machines', 'MachineID', machineId);
  if (!machine) {
    return { success: false, message: 'ไม่พบเครื่องจักร' };
  }

  var currentProducts = String(machine.AssignedProducts).split(',').map(function(s) { return s.trim(); });
  currentProducts = currentProducts.filter(function(p) { return p !== productCode; });

  updateRow('Machines', 'MachineID', machineId, {
    AssignedProducts: currentProducts.join(', ')
  });

  return { success: true };
}

function getMachineWithStats(machineId) {
  var machine = findRow('Machines', 'MachineID', machineId);
  if (!machine) return null;

  var today = formatDateOnly(new Date());
  var todayLogs = findRows('ProductionLog', function(row) {
    return row.MachineID === machineId &&
           formatDateOnly(new Date(row.Timestamp)) === today &&
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
    todayOutput: totalOutput,
    todayEntries: todayLogs.length,
    openTickets: openTickets.length
  };
}
