/**
 * Google Sheets Database Abstraction Layer
 * Handles all read/write operations with lock management
 */

var SPREADSHEET_ID = null;
var SECURE_SPREADSHEET_ID = null;
var SECURE_SPREADSHEET_ID_LOADED = false; // so the "unset" case is cached too, not re-fetched every access

// Confidential sheets that hold personal/financial data (salaries, cost P&L).
// They live in a SEPARATE spreadsheet that is NOT shared broadly, so people who
// need direct access to the main spreadsheet can't read them. The web app reaches
// them through Apps Script (which runs as the deploying owner), so app features are
// unaffected. Configure the second file's ID as the SECURE_SPREADSHEET_ID script
// property; if it's unset, these sheets transparently fall back to the main
// spreadsheet so nothing breaks before the secure file is set up.
var SECURE_SHEETS = ['LaborEmployees', 'CostPLConfig'];

function getSpreadsheet() {
  if (!SPREADSHEET_ID) {
    SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  }
  if (!SPREADSHEET_ID) {
    throw new Error('SPREADSHEET_ID not set in Script Properties. Please configure it first.');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSecureSpreadsheet() {
  if (!SECURE_SPREADSHEET_ID_LOADED) {
    SECURE_SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SECURE_SPREADSHEET_ID');
    SECURE_SPREADSHEET_ID_LOADED = true;
  }
  if (!SECURE_SPREADSHEET_ID) {
    return getSpreadsheet(); // not configured yet — keep confidential sheets in the main file
  }
  return SpreadsheetApp.openById(SECURE_SPREADSHEET_ID);
}

function getSpreadsheetForSheet(sheetName) {
  return SECURE_SHEETS.indexOf(sheetName) !== -1 ? getSecureSpreadsheet() : getSpreadsheet();
}

function getSheet(sheetName) {
  var ss = getSpreadsheetForSheet(sheetName);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Sheet "' + sheetName + '" not found.');
  }
  return sheet;
}

/**
 * Return a sheet, creating it (with the given header row) if it does not exist.
 * Use this for sheets that may not have been created by initializeSystem() yet,
 * so feature code can self-heal instead of throwing "Sheet ... not found".
 */
function ensureSheetExists(sheetName, headers) {
  var ss = getSpreadsheetForSheet(sheetName);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers && headers.length) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function getHeaders(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function mapRowsToObjects(headers, data) {
  return data.map(function(row) {
    var obj = {};
    headers.forEach(function(header, i) {
      var val = row[i];
      // Google Sheets auto-converts date strings to Date objects.
      // Convert them back to strings so filtering by string comparison works.
      if (val instanceof Date && !isNaN(val.getTime())) {
        var h = val.getHours(), m = val.getMinutes(), s = val.getSeconds();
        if (h === 0 && m === 0 && s === 0) {
          val = Utilities.formatDate(val, 'Asia/Bangkok', 'yyyy-MM-dd');
        } else {
          val = Utilities.formatDate(val, 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
        }
      }
      obj[header] = val;
    });
    return obj;
  });
}

function getAllRows(sheetName) {
  var sheet = getSheet(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var headers = getHeaders(sheet);
  var data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  return mapRowsToObjects(headers, data);
}

/**
 * Read only the tail of an append-only log sheet instead of the whole thing.
 *
 * Log sheets (ProductionLog, MaintenanceLog, ...) are only ever appended to, and the
 * timestamp column is stamped server-side at append time, so rows are in chronological
 * order top-to-bottom. That means we can read upwards in chunks from the bottom and
 * stop as soon as a chunk reaches past the cutoff — instead of pulling (and date-
 * formatting) every row ever recorded just to show the last couple of days.
 *
 * Falls back to a full read when the cutoff is unusable, and never stops early on rows
 * whose timestamp can't be parsed, so a malformed cell can only cost speed, not data.
 */
function getRowsSince(sheetName, timestampColumn, cutoff, chunkSize) {
  var cutoffMs = (cutoff instanceof Date) ? cutoff.getTime() : new Date(cutoff).getTime();
  if (!cutoffMs || isNaN(cutoffMs)) return getAllRows(sheetName);

  var sheet = getSheet(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var headers = getHeaders(sheet);
  if (headers.indexOf(timestampColumn) === -1) return getAllRows(sheetName);

  var remaining = lastRow - 1; // data rows not read yet, counted from the top
  var chunk = chunkSize || 500;
  var collected = [];

  while (remaining > 0) {
    var take = Math.min(chunk, remaining);
    var startRow = remaining - take + 2; // +1 for the header row, +1 for 1-based rows
    var rows = mapRowsToObjects(headers, sheet.getRange(startRow, 1, take, headers.length).getValues());
    collected = rows.concat(collected);
    remaining -= take;

    var oldest = rows.length ? new Date(rows[0][timestampColumn]) : null;
    if (oldest && !isNaN(oldest.getTime()) && oldest.getTime() < cutoffMs) break;
  }

  return collected;
}

function appendRow(sheetName, rowObject) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var sheet = getSheet(sheetName);
    var headers = getHeaders(sheet);
    var newRow = headers.map(function(header) {
      return rowObject[header] !== undefined ? rowObject[header] : '';
    });
    sheet.appendRow(newRow);
  } finally {
    lock.releaseLock();
  }
}

function updateRow(sheetName, matchColumn, matchValue, updates) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var sheet = getSheet(sheetName);
    var headers = getHeaders(sheet);
    var data = sheet.getDataRange().getValues();
    var colIndex = headers.indexOf(matchColumn);

    if (colIndex === -1) {
      throw new Error('Column "' + matchColumn + '" not found in sheet "' + sheetName + '".');
    }

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][colIndex]) === String(matchValue)) {
        for (var key in updates) {
          var updateColIndex = headers.indexOf(key);
          if (updateColIndex !== -1) {
            sheet.getRange(i + 1, updateColIndex + 1).setValue(updates[key]);
          }
        }
        return true;
      }
    }
    return false;
  } finally {
    lock.releaseLock();
  }
}

function findRows(sheetName, filterFn) {
  var allRows = getAllRows(sheetName);
  return allRows.filter(filterFn);
}

function findRow(sheetName, matchColumn, matchValue) {
  var rows = findRows(sheetName, function(row) {
    return String(row[matchColumn]) === String(matchValue);
  });
  return rows.length > 0 ? rows[0] : null;
}

function countRows(sheetName, filterFn) {
  if (!filterFn) {
    var sheet = getSheet(sheetName);
    return Math.max(0, sheet.getLastRow() - 1);
  }
  return findRows(sheetName, filterFn).length;
}

function deleteRow(sheetName, matchColumn, matchValue) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var sheet = getSheet(sheetName);
    var headers = getHeaders(sheet);
    var data = sheet.getDataRange().getValues();
    var colIndex = headers.indexOf(matchColumn);

    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][colIndex]) === String(matchValue)) {
        sheet.deleteRow(i + 1);
        return true;
      }
    }
    return false;
  } finally {
    lock.releaseLock();
  }
}

function ensureColumnExists(sheetName, columnName) {
  // Fast path: the column almost always already exists (these calls are self-healing
  // leftovers for sheets created before a column was introduced). Checking the header
  // row first keeps read-only requests off the script lock entirely — otherwise every
  // page load queues behind whatever write is in flight, for up to 10 seconds.
  var existingIdx = getHeaders(getSheet(sheetName)).indexOf(columnName);
  if (existingIdx !== -1) return existingIdx + 1;

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var sheet = getSheet(sheetName);
    var headers = getHeaders(sheet);
    var idx = headers.indexOf(columnName);
    if (idx !== -1) return idx + 1; // another execution added it while we waited

    var newCol = headers.length + 1;
    sheet.getRange(1, newCol).setValue(columnName).setFontWeight('bold');
    return newCol;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Check if a cell value represents "active/true" regardless of type.
 * Handles: boolean true, string "TRUE"/"true", number 1, etc.
 */
function isActiveValue(val) {
  if (val === true || val === 1) return true;
  if (typeof val === 'string') {
    var s = val.toLowerCase().trim();
    return s === 'true' || s === '1' || s === 'yes';
  }
  return false;
}
