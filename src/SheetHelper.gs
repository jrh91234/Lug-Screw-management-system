/**
 * Google Sheets Database Abstraction Layer
 * Handles all read/write operations with lock management
 */

var SPREADSHEET_ID = null;

function getSpreadsheet() {
  if (!SPREADSHEET_ID) {
    SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  }
  if (!SPREADSHEET_ID) {
    throw new Error('SPREADSHEET_ID not set in Script Properties. Please configure it first.');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet(sheetName) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Sheet "' + sheetName + '" not found.');
  }
  return sheet;
}

function getHeaders(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function getAllRows(sheetName) {
  var sheet = getSheet(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var headers = getHeaders(sheet);
  var data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  return data.map(function(row) {
    var obj = {};
    headers.forEach(function(header, i) {
      obj[header] = row[i];
    });
    return obj;
  });
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
