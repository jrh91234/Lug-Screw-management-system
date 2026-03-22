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

  var now = data.reportTime ? new Date(data.reportTime) : new Date();
  if (isNaN(now.getTime())) now = new Date();
  var ticketId = 'MT-' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase();

  // Save photos to Google Drive if provided
  var photoUrls = '';
  var photoErrors = 0;
  if (data.photos && data.photos.length > 0) {
    var urls = [];
    for (var i = 0; i < data.photos.length; i++) {
      try {
        var url = savePhotoToDrive(data.photos[i], ticketId + '_report_' + (i + 1), ticketId);
        if (url) {
          urls.push(url);
        } else {
          photoErrors++;
          Logger.log('Photo ' + (i + 1) + ': savePhotoToDrive returned empty (input length: ' + (data.photos[i] ? data.photos[i].length : 0) + ')');
        }
      } catch (e) {
        photoErrors++;
        Logger.log('Photo save error: ' + e.message);
      }
    }
    photoUrls = urls.join(', ');
  }

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
    Resolution: '',
    Photos: photoUrls
  });

  // Update machine status based on priority
  if (data.priority === 'critical' || data.priority === 'high') {
    updateMachineStatus(data.machineId, 'down');
  } else {
    updateMachineStatus(data.machineId, 'maintenance');
  }

  var msg = 'แจ้งซ่อมเรียบร้อย หมายเลข: ' + ticketId;
  if (photoErrors > 0) {
    msg += ' (บันทึกรูปไม่สำเร็จ ' + photoErrors + ' รูป)';
  }
  return { success: true, ticketId: ticketId, message: msg };
}

function updateTicketStatus(token, ticketId, status, resolution, photos, resolveTime) {
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

  // Return ticket: set back to open so another technician can pick it up
  if (status === 'returned') {
    updates.Status = 'open';
    updates.AssignedTo = '';
    updates.Resolution = (ticket.Resolution ? ticket.Resolution + ' | ' : '') + 'คืนงานโดย ' + user.employeeId + ' (' + formatDate(new Date()) + ')';
    updateRow('MaintenanceLog', 'TicketID', ticketId, updates);
    return { success: true, message: 'คืนงานเรียบร้อย ticket กลับสู่สถานะรอรับงาน' };
  }

  if (status === 'resolved' || status === 'closed') {
    var now = resolveTime ? new Date(resolveTime) : new Date();
    if (isNaN(now.getTime())) now = new Date();
    updates.ResolvedAt = formatDate(now);
    updates.Resolution = resolution || '';

    // Calculate downtime
    var reportedTime = new Date(ticket.Timestamp);
    updates.DowntimeMinutes = Math.round((now - reportedTime) / 60000);
    if (updates.DowntimeMinutes < 0) updates.DowntimeMinutes = 0;

    // Save resolution photos to Google Drive if provided
    var resolvePhotoErrors = 0;
    if (photos && photos.length > 0) {
      var urls = [];
      for (var i = 0; i < photos.length; i++) {
        try {
          var url = savePhotoToDrive(photos[i], ticketId + '_resolved_' + (i + 1), ticketId);
          if (url) {
            urls.push(url);
          } else {
            resolvePhotoErrors++;
          }
        } catch (e) {
          resolvePhotoErrors++;
          Logger.log('Resolution photo save error: ' + e.message);
        }
      }
      updates.ResolutionPhotos = urls.join(', ');
    }

    // Restore machine status
    updateMachineStatus(ticket.MachineID, 'running');
  }

  updateRow('MaintenanceLog', 'TicketID', ticketId, updates);
  var resultMsg = 'อัพเดทสถานะเรียบร้อย';
  if (typeof resolvePhotoErrors !== 'undefined' && resolvePhotoErrors > 0) {
    resultMsg += ' (บันทึกรูปไม่สำเร็จ ' + resolvePhotoErrors + ' รูป)';
  }
  return { success: true, message: resultMsg };
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

  // Sort tickets: open/in-progress first, then by timestamp desc
  var statusOrder = { 'open': 0, 'in-progress': 1, 'resolved': 2, 'closed': 3 };
  logs.sort(function(a, b) {
    var sDiff = (statusOrder[a.Status] || 9) - (statusOrder[b.Status] || 9);
    if (sDiff !== 0) return sDiff;
    return new Date(b.Timestamp) - new Date(a.Timestamp);
  });

  var tickets = logs.map(function(log) {
    return {
      ticketId: log.TicketID,
      date: log.Date,
      machineId: log.MachineID,
      issueType: log.IssueType,
      description: log.Description,
      priority: log.Priority,
      status: log.Status,
      reporterName: log.ReporterName,
      resolution: log.Resolution || '',
      downtimeMinutes: Number(log.DowntimeMinutes) || 0
    };
  });

  return {
    totalTickets: logs.length,
    totalDowntime: totalDowntime,
    byMachine: byMachine,
    byType: byType,
    openTickets: logs.filter(function(l) { return l.Status === 'open'; }).length,
    inProgressTickets: logs.filter(function(l) { return l.Status === 'in-progress'; }).length,
    resolvedTickets: logs.filter(function(l) { return l.Status === 'resolved' || l.Status === 'closed'; }).length,
    tickets: tickets
  };
}
