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

  ensureMaintenanceShiftColumns();
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
    Date: getWorkDate(now),
    ShiftAB: user.shift || '',
    ShiftDN: getShiftDNFromInput(data.reportTime, now),
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

function getShiftDNFromInput(reportTime, fallbackDate) {
  var raw = String(reportTime || '');
  var m = raw.match(/T(\d{2})/);
  if (m && m[1] != null) {
    var hh = Number(m[1]);
    if (!isNaN(hh)) return (hh >= 8 && hh < 20) ? 'Day' : 'Night';
  }
  return detectShift(fallbackDate || new Date());
}

function ensureMaintenanceShiftColumns() {
  ensureColumnExists('MaintenanceLog', 'ShiftAB');
  ensureColumnExists('MaintenanceLog', 'ShiftDN');
}

function getUserShiftMap() {
  var users = getAllRows('Users');
  var map = {};
  users.forEach(function(u) {
    var employeeId = String(u.EmployeeID || '').trim();
    var shift = String(u.Shift || '').toUpperCase().trim();
    if (!employeeId) return;
    if (shift === 'A' || shift === 'B') {
      map[employeeId] = shift;
    }
  });
  return map;
}

function getMaintenanceShiftAB(log) {
  var shiftAB = String(log.ShiftAB || '').toUpperCase();
  if (shiftAB === 'A' || shiftAB === 'B') return shiftAB;

  var byReporter = String(log.ReportedBy || '').trim();
  if (byReporter) {
    var user = findRow('Users', 'EmployeeID', byReporter);
    if (user) {
      var userShift = String(user.Shift || '').toUpperCase().trim();
      if (userShift === 'A' || userShift === 'B') return userShift;
    }
  }

  return '';
}

function parseSheetDateTime(value) {
  var text = String(value || '').trim();
  if (!text) return null;
  var dt = new Date(text);
  if (!isNaN(dt.getTime())) return dt;
  return null;
}

function getMaintenanceReferenceDateTime(log) {
  var resolvedAt = parseSheetDateTime(log.ResolvedAt);
  if (resolvedAt) return resolvedAt;
  return parseSheetDateTime(log.Timestamp);
}

function getMaintenanceFilterDate(log) {
  var ref = getMaintenanceReferenceDateTime(log);
  if (ref) return getWorkDate(ref);
  return String(log.Date || '');
}

function backfillMaintenanceShiftAB(token) {
  var user = validateSession(token);
  if (!user || String(user.role || '').toLowerCase() !== 'admin') {
    return { success: false, message: 'ไม่มีสิทธิ์ใช้งาน' };
  }

  ensureMaintenanceShiftColumns();
  var logs = getAllRows('MaintenanceLog');
  var userShiftMap = getUserShiftMap();
  var updated = 0;
  var skipped = 0;

  logs.forEach(function(log) {
    var current = String(log.ShiftAB || '').toUpperCase().trim();
    if (current === 'A' || current === 'B') return;

    var reporter = String(log.ReportedBy || '').trim();
    var target = userShiftMap[reporter] || '';
    if (target !== 'A' && target !== 'B') {
      skipped++;
      return;
    }

    var ok = updateRow('MaintenanceLog', 'TicketID', log.TicketID, { ShiftAB: target });
    if (ok) updated++;
  });

  return {
    success: true,
    message: 'Backfill สำเร็จ',
    updated: updated,
    skipped: skipped
  };
}

function getMaintenanceShiftDN(log) {
  var shiftDN = String(log.ShiftDN || '').toLowerCase();
  if (shiftDN === 'day' || shiftDN === 'night') return shiftDN;
  var ref = getMaintenanceReferenceDateTime(log);
  if (ref) return String(detectShift(ref) || '').toLowerCase();
  return '';
}

function getMaintenanceSymptoms(token) {
  var user = validateSession(token);
  if (!user) return [];

  var logs = getAllRows('MaintenanceLog');
  var freq = {};

  logs.forEach(function(log) {
    var desc = String(log.Description || '').trim();
    if (!desc) return;
    // Split combined descriptions added by quick-insert ("a | b | c")
    desc.split('|').forEach(function(part) {
      var s = String(part || '').trim();
      if (!s) return;
      freq[s] = (freq[s] || 0) + 1;
    });
  });

  return Object.keys(freq)
    .sort(function(a, b) { return freq[b] - freq[a]; })
    .slice(0, 30);
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
        var d = getMaintenanceFilterDate(log);
        return d >= filters.dateFrom && d <= filters.dateTo;
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

function isMaintenanceClosedStatus(status) {
  var s = String(status || '').toLowerCase();
  return s === 'resolved' || s === 'closed';
}

function applyMaintenanceShiftFilters(logs, shiftABFilter, shiftDNFilter) {
  var filtered = logs || [];
  if (shiftABFilter && shiftABFilter !== 'all') {
    var targetAB = String(shiftABFilter || '').toUpperCase();
    filtered = filtered.filter(function(log) {
      return getMaintenanceShiftAB(log) === targetAB;
    });
  }

  if (shiftDNFilter && shiftDNFilter !== 'all') {
    var targetDN = String(shiftDNFilter || '').toLowerCase();
    filtered = filtered.filter(function(log) {
      return getMaintenanceShiftDN(log) === targetDN;
    });
  }
  return filtered;
}

function getMaintenanceSummary(dateFrom, dateTo, shiftABFilter, shiftDNFilter) {
  ensureMaintenanceShiftColumns();
  var logs = findRows('MaintenanceLog', function(row) {
    var d = getMaintenanceFilterDate(row);
    return d >= dateFrom && d <= dateTo;
  });

  logs = applyMaintenanceShiftFilters(logs, shiftABFilter, shiftDNFilter);

  var unresolvedLogs = findRows('MaintenanceLog', function(row) {
    var d = getMaintenanceFilterDate(row);
    return d && d <= dateTo && !isMaintenanceClosedStatus(row.Status);
  });
  // Unresolved jobs can affect the selected day even if they were opened in a previous Day/Night bucket.
  unresolvedLogs = applyMaintenanceShiftFilters(unresolvedLogs, shiftABFilter, 'all');

  var unresolvedByTicket = {};
  unresolvedLogs.forEach(function(log) {
    unresolvedByTicket[String(log.TicketID || '')] = true;
  });

  var mergedLogs = logs.slice();
  var seenTickets = {};
  mergedLogs.forEach(function(log) {
    seenTickets[String(log.TicketID || '')] = true;
  });
  unresolvedLogs.forEach(function(log) {
    var ticketId = String(log.TicketID || '');
    if (!seenTickets[ticketId]) {
      mergedLogs.push(log);
      seenTickets[ticketId] = true;
    }
  });

  var byMachine = {};
  var byType = {};
  var totalDowntime = 0;

  mergedLogs.forEach(function(log) {
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

  // Sort tickets: unresolved first, then by timestamp desc
  var statusOrder = { 'open': 0, 'in-progress': 1, 'returned': 2, 'resolved': 3, 'closed': 4 };
  mergedLogs.sort(function(a, b) {
    var sDiff = (statusOrder[a.Status] || 9) - (statusOrder[b.Status] || 9);
    if (sDiff !== 0) return sDiff;
    return new Date(b.Timestamp) - new Date(a.Timestamp);
  });

  var tickets = mergedLogs.map(function(log) {
    var ticketId = String(log.TicketID || '');
    return {
      ticketId: log.TicketID,
      date: log.Date,
      shiftAB: getMaintenanceShiftAB(log),
      shiftDN: getMaintenanceShiftDN(log),
      machineId: log.MachineID,
      issueType: log.IssueType,
      description: log.Description,
      priority: log.Priority,
      status: log.Status,
      reporterName: log.ReporterName,
      resolution: log.Resolution || '',
      downtimeMinutes: Number(log.DowntimeMinutes) || 0,
      unresolved: !!unresolvedByTicket[ticketId],
      carriedOver: !!unresolvedByTicket[ticketId] && getMaintenanceFilterDate(log) < dateFrom
    };
  });

  return {
    totalTickets: logs.length,
    totalShownTickets: mergedLogs.length,
    totalDowntime: totalDowntime,
    byMachine: byMachine,
    byType: byType,
    openTickets: unresolvedLogs.filter(function(l) { return String(l.Status || '').toLowerCase() === 'open'; }).length,
    inProgressTickets: unresolvedLogs.filter(function(l) { return String(l.Status || '').toLowerCase() === 'in-progress'; }).length,
    unresolvedTickets: unresolvedLogs.map(function(log) {
      return {
        ticketId: log.TicketID,
        date: log.Date,
        shiftAB: getMaintenanceShiftAB(log),
        shiftDN: getMaintenanceShiftDN(log),
        machineId: log.MachineID,
        issueType: log.IssueType,
        description: log.Description,
        priority: log.Priority,
        status: log.Status,
        reporterName: log.ReporterName,
        resolution: log.Resolution || '',
        downtimeMinutes: Number(log.DowntimeMinutes) || 0,
        unresolved: true,
        carriedOver: getMaintenanceFilterDate(log) < dateFrom
      };
    }),
    unresolvedTicketCount: unresolvedLogs.length,
    resolvedTickets: logs.filter(function(l) { return isMaintenanceClosedStatus(l.Status); }).length,
    tickets: tickets
  };
}
