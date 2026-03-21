/**
 * H1 Lug&Screw Production Management System
 * Main Entry Point - Routing and HTML Serving
 */

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'Login';

  var validPages = ['Login', 'ProductionEntry', 'MaintenanceReport', 'Dashboard', 'MachineStatus', 'AdminPanel'];

  if (validPages.indexOf(page) === -1) {
    page = 'Login';
  }

  var template = HtmlService.createTemplateFromFile('pages/' + page);
  return template.evaluate()
    .setTitle('H1 Lug&Screw Production Management')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setFaviconUrl('https://img.icons8.com/color/48/factory.png');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Initialize the system - creates all required sheets if they don't exist
 * Run this function once after setting up the spreadsheet
 */
function initializeSystem() {
  var ss = getSpreadsheet();

  // Users sheet
  createSheetIfNotExists(ss, 'Users',
    ['EmployeeID', 'Name', 'PIN', 'Role', 'Active', 'CreatedAt']);

  // Products sheet
  createSheetIfNotExists(ss, 'Products',
    ['ProductCode', 'ProductName', 'DefaultQty', 'Active']);

  // BOM sheet
  createSheetIfNotExists(ss, 'BOM',
    ['ProductCode', 'ComponentCode', 'ComponentName', 'QtyPerUnit', 'Supplier']);

  // Machines sheet
  createSheetIfNotExists(ss, 'Machines',
    ['MachineID', 'MachineName', 'Line', 'Status', 'AssignedProducts']);

  // ProductionLog sheet
  createSheetIfNotExists(ss, 'ProductionLog',
    ['LogID', 'Timestamp', 'Date', 'Shift', 'EmployeeID', 'EmployeeName', 'MachineID', 'ProductCode', 'PlannedQty', 'ActualQty', 'DefectQty', 'Remark', 'Status']);

  // MaintenanceLog sheet
  createSheetIfNotExists(ss, 'MaintenanceLog',
    ['TicketID', 'Timestamp', 'Date', 'ReportedBy', 'ReporterName', 'MachineID', 'IssueType', 'Description', 'Priority', 'Status', 'AssignedTo', 'ResolvedAt', 'DowntimeMinutes', 'Resolution']);

  // Seed initial data
  seedInitialData(ss);

  Logger.log('System initialized successfully!');
}

function createSheetIfNotExists(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function seedInitialData(ss) {
  // Seed Machines
  var machinesSheet = ss.getSheetByName('Machines');
  if (machinesSheet.getLastRow() <= 1) {
    var machines = [
      ['LS-04', 'Lug & Screw 4', 'H1', 'running', '51207611A(BOI)-S, 51207611A(NON)-S'],
      ['LS-05', 'Lug & Screw 5', 'H1', 'running', '51207611A(BOI)-S, 51207611A(NON)-S'],
      ['LS-06', 'Lug & Screw 6', 'H1', 'running', '51207611A(BOI)-S, 51207611A(NON)-S'],
      ['LS-07', 'Lug & Screw 7', 'H1', 'running', '51207611A(BOI)-S, 51207611A(NON)-S'],
      ['LS-08', 'Lug & Screw 8', 'H1', 'running', '51207611A(BOI)-S, 51207611A(NON)-S'],
      ['LS-09', 'Lug & Screw 9', 'H1', 'running', '51207611A(BOI)-S, 51207611A(NON)-S'],
      ['LS-10', 'Lug & Screw 10', 'H1', 'running', '51207611A(BOI)-S, 51207611A(NON)-S'],
      ['LS-11', 'Lug & Screw 11', 'H1', 'running', '51207611A(BOI)-S, 51207611A(NON)-S']
    ];
    machinesSheet.getRange(2, 1, machines.length, machines[0].length).setValues(machines);
  }

  // Seed Products
  var productsSheet = ss.getSheetByName('Products');
  if (productsSheet.getLastRow() <= 1) {
    var products = [
      ['51207611A(BOI)-S', 'Terminal Lug&Screw 25A Assy (BOI)', 1300, true],
      ['51207611A(NON)-S', 'Terminal Lug&Screw 25A Assy (NON)', 1300, true]
    ];
    productsSheet.getRange(2, 1, products.length, products[0].length).setValues(products);
  }

  // Seed BOM
  var bomSheet = ss.getSheetByName('BOM');
  if (bomSheet.getLastRow() <= 1) {
    var bom = [
      ['51207611A(BOI)-S', 'GHC11115A-BOI', 'TERMINAL LUG 25A', 1, 'SSVF (JMT Kelin) and SINO Thailand'],
      ['51207611A(BOI)-S', 'GHC11118A', 'Therminal screw 25A', 1, 'Thai Union'],
      ['51207611A(NON)-S', 'GHC11115A', 'TERMINAL LUG 25A', 1, 'SINO Thailand and Patterer'],
      ['51207611A(NON)-S', 'GHC11118A', 'Therminal screw 25A', 1, 'Thai Union']
    ];
    bomSheet.getRange(2, 1, bom.length, bom[0].length).setValues(bom);
  }

  // Seed default admin user
  var usersSheet = ss.getSheetByName('Users');
  if (usersSheet.getLastRow() <= 1) {
    var users = [
      ['ADMIN', 'Administrator', '1234', 'admin', true, formatDate(new Date())]
    ];
    usersSheet.getRange(2, 1, users.length, users[0].length).setValues(users);
  }
}
