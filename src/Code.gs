/**
 * H1 Lug&Screw Production Management System
 * Backend API - Returns JSON only (Frontend hosted on GitHub Pages)
 */

// === API Entry Points ===

function doGet(e) {
  var action = (e && e.parameter) ? e.parameter.action : '';
  var token = (e && e.parameter) ? e.parameter.token : '';
  var result;

  try {
    // Handle POST-like actions sent via GET (CORS workaround)
    if (e.parameter && e.parameter.payload) {
      var body = JSON.parse(e.parameter.payload);
      result = handlePostAction(body);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    switch (action) {
      case 'getMachines':
        result = getMachines();
        break;
      case 'getMachineProducts':
        result = getMachineProducts(e.parameter.machineId);
        break;
      case 'getMachineWithStats':
        result = getMachineWithStats(e.parameter.machineId);
        break;
      case 'getProducts':
        result = getProducts();
        break;
      case 'getProductBOM':
        result = getProductBOM(e.parameter.productCode);
        break;
      case 'getAllProductsWithBOM':
        result = getAllProductsWithBOM();
        break;
      case 'getOpenTickets':
        result = getOpenTickets();
        break;
      case 'getMaintenanceSymptoms':
        result = getMaintenanceSymptoms(token);
        break;
      case 'getProductionHistory':
        var filters = e.parameter.filters ? JSON.parse(e.parameter.filters) : {};
        result = getProductionHistory(token, filters);
        break;
      case 'getTodayProductionByEmployee':
        result = getTodayProductionByEmployee(token);
        break;
      case 'getRecentProductionByEmployee':
        result = getRecentProductionByEmployee(token, e.parameter.days);
        break;
      case 'getEditableProductionEntries':
        var editFilters = e.parameter.filters ? JSON.parse(e.parameter.filters) : {};
        result = getEditableProductionEntries(token, editFilters);
        break;
      case 'getInbox':
        result = getInbox(token);
        break;
      case 'getActionLogs':
        result = getActionLogs(token, e.parameter.limit);
        break;
      case 'getDashboardData':
        var dateRange = e.parameter.dateRange;
        try { dateRange = JSON.parse(dateRange); } catch(ex) {}
        result = getDashboardData(token, dateRange, e.parameter.shiftAB, e.parameter.shiftDN);
        break;
      case 'getSortedProductionData':
        var sFilters = e.parameter.filters ? JSON.parse(e.parameter.filters) : {};
        result = getSortedProductionData(token, e.parameter.sortField, e.parameter.sortOrder, sFilters);
        break;
      case 'exportProductionCSV':
        result = exportProductionCSV(token, e.parameter.dateFrom, e.parameter.dateTo);
        break;
      case 'getAllUsers':
        result = getAllUsers(token);
        break;
      case 'validateSession':
        result = validateSession(token);
        break;
      case 'getTodayRawMaterials':
        result = getTodayRawMaterials(token);
        break;
      case 'getRawMaterialHistory':
        var rmFilters = e.parameter.filters ? JSON.parse(e.parameter.filters) : {};
        result = getRawMaterialHistory(token, rmFilters);
        break;
      case 'validateRawMaterial':
        result = validateRawMaterialForMachine(e.parameter.machineId, e.parameter.partCode, e.parameter.partName);
        break;
      case 'getCostPL':
        result = getCostPL(token);
        break;
      case 'getWasteTypes':
        result = getWasteTypes(token);
        break;
      case 'getTodayWaste':
        result = getTodayWaste(token);
        break;
      case 'getWasteHistory':
        var wFilters = e.parameter.filters ? JSON.parse(e.parameter.filters) : {};
        result = getWasteHistory(token, wFilters);
        break;
      case 'getTodaySortingJobs':
        result = getTodaySortingJobs(token);
        break;
      case 'getSortingJobs':
        var sortFilters = e.parameter.filters ? JSON.parse(e.parameter.filters) : {};
        result = getSortingJobs(token, sortFilters);
        break;
      case 'getSortingDashboard':
        var sdFilters = e.parameter.filters ? JSON.parse(e.parameter.filters) : {};
        result = getSortingDashboard(token, sdFilters);
        break;
      default:
        result = { success: false, message: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { success: false, message: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ success: false, message: 'Invalid JSON body' });
  }

  var result = handlePostAction(body);
  return jsonResponse(result);
}

function handlePostAction(body) {
  var action = body.action || '';
  var token = body.token || '';
  var result;

  try {
    switch (action) {
      case 'login':
        result = authenticateUser(body.employeeId, body.pin);
        break;
      case 'logout':
        result = logout(token);
        break;
      case 'submitProduction':
        result = submitProduction(token, body.data);
        break;
      case 'cancelProduction':
        result = cancelProduction(token, body.logId);
        break;
      case 'updateProductionEntry':
        result = updateProductionEntry(token, body.logId, body.updates);
        break;
      case 'requestDeleteProduction':
        result = requestDeleteProduction(token, body.logId, body.reason);
        break;
      case 'approveDeleteProductionRequest':
        result = approveDeleteProductionRequest(token, body.requestId, body.approve, body.note);
        break;
      case 'markInboxRead':
        result = markInboxRead(token, body.inboxId);
        break;
      case 'submitMaintenanceTicket':
        result = submitMaintenanceTicket(token, body.data);
        break;
      case 'backfillMaintenanceShiftAB':
        result = backfillMaintenanceShiftAB(token);
        break;
      case 'updateTicketStatus':
        result = updateTicketStatus(token, body.ticketId, body.status, body.resolution, body.photos, body.resolveTime);
        break;
      case 'updateMachineStatus':
        result = updateMachineStatus(body.machineId, body.status);
        break;
      case 'updateMachineCapacity':
        result = updateMachineCapacity(token, body.machineId, body.capacity);
        break;
      case 'addUser':
        result = addUser(token, body.userData);
        break;
      case 'updateUser':
        result = updateUser(token, body.employeeId, body.updates);
        break;
      case 'assignProductToMachine':
        result = assignProductToMachine(token, body.machineId, body.productCode);
        break;
      case 'removeProductFromMachine':
        result = removeProductFromMachine(token, body.machineId, body.productCode);
        break;
      case 'setCurrentProduct':
        result = setCurrentProduct(token, body.machineId, body.productCode);
        break;
      case 'submitRawMaterial':
        result = submitRawMaterial(token, body.data);
        break;
      case 'ocrWithDrive':
        result = ocrWithDrive(token, body.data);
        break;
      case 'saveCostPL':
        result = saveCostPL(token, body.rows);
        break;
      case 'submitWaste':
        result = submitWaste(token, body.data);
        break;
      case 'addWasteType':
        result = addWasteType(token, body.typeName);
        break;
      case 'deleteWasteType':
        result = deleteWasteType(token, body.typeId);
        break;
      case 'submitSortingJob':
        result = submitSortingJob(token, body.data);
        break;
      case 'updateSortingJob':
        result = updateSortingJob(token, body.jobId, body.updates);
        break;
      case 'recordSortingResult':
        result = recordSortingResult(token, body.jobId, body.data);
        break;
      default:
        result = { success: false, message: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { success: false, message: err.message };
  }

  return result;
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// === System Initialization (run once) ===

function initializeSystem() {
  var ss = getSpreadsheet();

  createSheetIfNotExists(ss, 'Users',
    ['EmployeeID', 'Name', 'PIN', 'Role', 'Shift', 'Active', 'CreatedAt', 'Permissions']);
  createSheetIfNotExists(ss, 'Products',
    ['ProductCode', 'ProductName', 'DefaultQty', 'Active']);
  createSheetIfNotExists(ss, 'BOM',
    ['ProductCode', 'ComponentCode', 'ComponentName', 'QtyPerUnit', 'Supplier']);
  createSheetIfNotExists(ss, 'MaterialAlias',
    ['AliasCode', 'CanonicalCode', 'Note', 'Active']);
  createSheetIfNotExists(ss, 'Machines',
    ['MachineID', 'MachineName', 'Line', 'Status', 'AssignedProducts', 'CurrentProduct', 'Capacity']);
  createSheetIfNotExists(ss, 'ProductionLog',
    ['LogID', 'Timestamp', 'Date', 'Shift', 'TimePeriod', 'EmployeeID', 'EmployeeName', 'MachineID', 'ProductCode', 'PlannedQty', 'ActualQty', 'DefectQty', 'DefectDetails', 'Remark', 'Status']);
  createSheetIfNotExists(ss, 'ProductionDeleteRequests',
    ['RequestID', 'LogID', 'RequestedAt', 'RequestedBy', 'RequesterName', 'Reason', 'Status', 'ReviewedBy', 'ReviewedAt', 'ReviewNote', 'Snapshot']);
  createSheetIfNotExists(ss, 'Inbox',
    ['InboxID', 'EmployeeID', 'Type', 'Title', 'Message', 'RefID', 'Status', 'CreatedAt', 'CreatedBy']);
  createSheetIfNotExists(ss, 'ActionLog',
    ['ActionID', 'Timestamp', 'EmployeeID', 'EmployeeName', 'Action', 'Payload']);
  createSheetIfNotExists(ss, 'MaintenanceLog',
    ['TicketID', 'Timestamp', 'Date', 'ShiftAB', 'ShiftDN', 'ReportedBy', 'ReporterName', 'MachineID', 'IssueType', 'Description', 'Priority', 'Status', 'AssignedTo', 'ResolvedAt', 'DowntimeMinutes', 'Resolution', 'Photos', 'ResolutionPhotos']);
  createSheetIfNotExists(ss, 'RawMaterialLog',
    ['ReceiveID', 'Timestamp', 'Date', 'ReceivedBy', 'ReceiverName', 'MachineID', 'PartCode', 'SupplierCode', 'PartName', 'Specification', 'Quantity', 'Unit', 'LotNumber', 'Inspector', 'Customer', 'NetWeight', 'GrossWeight', 'CartonNo', 'PackingDate', 'Remark', 'Photos', 'Status']);
  createSheetIfNotExists(ss, 'CostPLConfig',
    ['ProductCode', 'ItemCode', 'Amount', 'UpdatedAt', 'UpdatedBy']);
  createSheetIfNotExists(ss, 'WasteLog',
    ['WasteID', 'Timestamp', 'Date', 'RecordedBy', 'RecorderName', 'WasteType', 'WeightKg', 'Remark']);
  createSheetIfNotExists(ss, 'WasteTypes',
    ['TypeID', 'TypeName', 'Active', 'CreatedAt', 'CreatedBy']);
  createSheetIfNotExists(ss, 'SortingLog',
    ['JobID', 'Timestamp', 'Date', 'Shift', 'ShiftDN', 'MachineID', 'ProductCode', 'FoundProcess', 'TotalQty', 'GoodQty', 'DefectQty', 'Status', 'RegisteredBy', 'RegisteredByName', 'CompletedAt', 'Remark']);

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

  var productsSheet = ss.getSheetByName('Products');
  if (productsSheet.getLastRow() <= 1) {
    var products = [
      ['51207611A(BOI)-S', 'Terminal Lug&Screw 25A Assy (BOI)', 1300, true],
      ['51207611A(NON)-S', 'Terminal Lug&Screw 25A Assy (NON)', 1300, true]
    ];
    productsSheet.getRange(2, 1, products.length, products[0].length).setValues(products);
  }

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

  var wasteTypesSheet = ss.getSheetByName('WasteTypes');
  if (wasteTypesSheet.getLastRow() <= 1) {
    var wasteTypes = [
      ['WT-00000001', 'กล่องกระดาษ', true, formatDate(new Date()), 'system'],
      ['WT-00000002', 'ฟิมล์ยืด', true, formatDate(new Date()), 'system']
    ];
    wasteTypesSheet.getRange(2, 1, wasteTypes.length, wasteTypes[0].length).setValues(wasteTypes);
  }

  var aliasSheet = ss.getSheetByName('MaterialAlias');
  if (aliasSheet.getLastRow() <= 1) {
    var aliases = [
      // ตัวอย่าง: ผู้ใช้สามารถเพิ่ม mapping เพิ่มเองได้ตามฉลากจริงหน้างาน
      ['GHC11115A-BOI', 'GHC11115A', 'Normalize BOI variant', true],
      ['GHC11115A(NON)', 'GHC11115A', 'Normalize NON variant', true],
      ['6108048', 'GHC11118A', 'Supplier numeric code mapping', true]
    ];
    aliasSheet.getRange(2, 1, aliases.length, aliases[0].length).setValues(aliases);
  }

  var usersSheet = ss.getSheetByName('Users');
  if (usersSheet.getLastRow() <= 1) {
    var props = PropertiesService.getScriptProperties();
    var adminId = props.getProperty('INITIAL_ADMIN_EMPLOYEE_ID');
    var adminPin = props.getProperty('INITIAL_ADMIN_PIN');

    if (adminId && adminPin) {
      var users = [
        [adminId, 'Administrator', adminPin, 'admin', '', true, formatDate(new Date()), '']
      ];
      usersSheet.getRange(2, 1, users.length, users[0].length).setValues(users);
    } else {
      Logger.log('No default admin seeded. Set INITIAL_ADMIN_EMPLOYEE_ID and INITIAL_ADMIN_PIN in Script Properties for first-time bootstrap.');
    }
  }
}
