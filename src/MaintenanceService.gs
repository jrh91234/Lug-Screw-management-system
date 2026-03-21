/**
 * Maintenance and Repair Ticket Service
 */

function submitMaintenanceTicket(token, data) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }

  if (!data.machineId || !data.issueType || !data.description) {
    return { success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' };
  }

  var now = new Date();
  var ticketId = 'MT-' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase();

  appendRow('MaintenanceLog', {
    TicketID: ticketId,
    Timestamp: formatDate(now),
    Date: formatDateOnly(now),
    ReportedBy: user.employeeId,
    ReporterName: user.name,
    MachineID: data.machineId,
    IssueType: data.issueType,
    Description: data.description,
    Priority: data.priority || 'medium',
    Status: 'open',
    AssignedTo: '',
    ResolvedAt: '',
    DowntimeMinutes: 0,
    Resolution: ''
  });

  // Update machine status based on priority
  if (data.priority === 'critical' || data.priority === 'high') {
    updateMachineStatus(data.machineId, 'down');
  } else {
    updateMachineStatus(data.machineId, 'maintenance');
  }

  return { success: true, ticketId: ticketId, message: 'แจ้งซ่อมเรียบร้อย หมายเลข: ' + ticketId };
}

function updateTicketStatus(token, ticketId, status, resolution) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }

  if (!hasRole(token, 'maintenance')) {
    return { success: false, message: 'ไม่มีสิทธิ์อัพเดทสถานะ' };
  }

  var ticket = findRow('MaintenanceLog', 'TicketID', ticketId);
  if (!ticket) {
    return { success: false, message: 'ไม่พบใบแจ้งซ่อม' };
  }

  var updates = { Status: status };

  if (status === 'in-progress') {
    updates.AssignedTo = user.employeeId;
  }

  if (status === 'resolved' || status === 'closed') {
    var now = new Date();
    updates.ResolvedAt = formatDate(now);
    updates.Resolution = resolution || '';

    // Calculate downtime
    var reportedTime = new Date(ticket.Timestamp);
    updates.DowntimeMinutes = Math.round((now - reportedTime) / 60000);

    // Restore machine status
    updateMachineStatus(ticket.MachineID, 'running');
  }

  updateRow('MaintenanceLog', 'TicketID', ticketId, updates);
  return { success: true, message: 'อัพเดทสถานะเรียบร้อย' };
}

function getOpenTickets() {
  var tickets = findRows('MaintenanceLog', function(row) {
    return row.Status === 'open' || row.Status === 'in-progress';
  });

  // Sort by priority (critical first) then by timestamp
  var priorityOrder = { 'critical': 0, 'high': 1, 'medium': 2, 'low': 3 };
  tickets.sort(function(a, b) {
    var pDiff = (priorityOrder[a.Priority] || 3) - (priorityOrder[b.Priority] || 3);
    if (pDiff !== 0) return pDiff;
    return new Date(b.Timestamp) - new Date(a.Timestamp);
  });

  return tickets;
}

function getMaintenanceHistory(filters) {
  var logs = getAllRows('MaintenanceLog');

  if (filters) {
    if (filters.dateFrom && filters.dateTo) {
      logs = logs.filter(function(log) {
        return log.Date >= filters.dateFrom && log.Date <= filters.dateTo;
      });
    }
    if (filters.machineId) {
      logs = logs.filter(function(log) {
        return log.MachineID === filters.machineId;
      });
    }
    if (filters.status) {
      logs = logs.filter(function(log) {
        return log.Status === filters.status;
      });
    }
  }

  logs.sort(function(a, b) {
    return new Date(b.Timestamp) - new Date(a.Timestamp);
  });

  return logs;
}

function getMaintenanceSummary(dateFrom, dateTo) {
  var logs = findRows('MaintenanceLog', function(row) {
    return row.Date >= dateFrom && row.Date <= dateTo;
  });

  var byMachine = {};
  var byType = {};
  var totalDowntime = 0;

  logs.forEach(function(log) {
    // By machine
    if (!byMachine[log.MachineID]) {
      byMachine[log.MachineID] = { tickets: 0, downtime: 0 };
    }
    byMachine[log.MachineID].tickets++;
    byMachine[log.MachineID].downtime += Number(log.DowntimeMinutes) || 0;

    // By type
    if (!byType[log.IssueType]) {
      byType[log.IssueType] = 0;
    }
    byType[log.IssueType]++;

    totalDowntime += Number(log.DowntimeMinutes) || 0;
  });

  return {
    totalTickets: logs.length,
    totalDowntime: totalDowntime,
    byMachine: byMachine,
    byType: byType,
    openTickets: logs.filter(function(l) { return l.Status === 'open'; }).length,
    resolvedTickets: logs.filter(function(l) { return l.Status === 'resolved' || l.Status === 'closed'; }).length
  };
}
