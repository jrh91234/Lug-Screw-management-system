/**
 * Raw Material Receiving Service
 */

/**
 * Validate raw material partCode against machine's assigned products' BOM
 * Returns { valid, matchedComponents[], allComponents[] }
 */
function validateRawMaterialForMachine(machineId, partCode, partName) {
  if (!machineId || !partCode) {
    return { valid: false, matchedComponents: [], allComponents: [], message: 'กรุณาเลือกเครื่องจักรและกรอกรหัสชิ้นส่วน (Part Code)' };
  }

  var machine = findRow('Machines', 'MachineID', machineId);
  if (!machine) {
    return { valid: false, matchedComponents: [], allComponents: [], message: 'ไม่พบเครื่องจักร: ' + machineId };
  }

  var assignedStr = machine.AssignedProducts ? String(machine.AssignedProducts).trim() : '';
  if (!assignedStr) {
    return { valid: false, matchedComponents: [], allComponents: [], message: 'เครื่อง ' + machineId + ' ไม่มีสินค้าที่กำหนด' };
  }

  var productCodes = assignedStr.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });

  // Collect all BOM components for assigned products
  var allComponents = [];
  var codeMatchedComponents = [];
  var matchedComponents = [];
  var candidateCodes = buildMaterialCodeCandidates(partCode);
  var inputPartName = String(partName || '').trim();

  var exactCodeMatched = [];
  var exactMatched = [];

  productCodes.forEach(function(pc) {
    var bom = getProductBOM(pc);
    bom.forEach(function(comp) {
      allComponents.push({
        productCode: pc,
        componentCode: comp.componentCode,
        componentName: comp.componentName,
        supplier: comp.supplier
      });
      // Match by componentCode (supports alternate labels/tags and BOI/NON suffix variants)
      var exact = isExactMaterialCodeMatch(comp.componentCode, candidateCodes);
      if (exact || isMaterialCodeMatch(comp.componentCode, candidateCodes)) {
        var entry = {
          productCode: pc,
          componentCode: comp.componentCode,
          componentName: comp.componentName,
          supplier: comp.supplier
        };
        codeMatchedComponents.push(entry);
        if (exact) exactCodeMatched.push(entry);
        if (inputPartName && !isPartNameMatch(comp.componentName, inputPartName)) {
          return;
        }
        matchedComponents.push(entry);
        if (exact) exactMatched.push(entry);
      }
    });
  });

  // Prefer exact canonical matches so BOI vs NON variants are not confused by substring overlap
  // (e.g. "GHC11115A" must map to NON, not GHC11115A-BOI which contains it as a prefix).
  if (exactMatched.length > 0) matchedComponents = exactMatched;
  if (exactCodeMatched.length > 0) codeMatchedComponents = exactCodeMatched;

  if (matchedComponents.length > 0) {
    return { valid: true, matchedComponents: matchedComponents, allComponents: allComponents, message: 'วัตถุดิบตรงกับ BOM' };
  }

  // Fallback: if Part Code matches BOM but OCR/typed Part Name doesn't match, allow by code
  if (codeMatchedComponents.length > 0) {
    return {
      valid: true,
      matchedComponents: codeMatchedComponents,
      allComponents: allComponents,
      warning: true,
      message: 'Part Code ตรง BOM แต่ Part Name ไม่ตรง 100% (ระบบอนุญาตตาม Part Code)'
    };
  }

  return {
    valid: false,
    matchedComponents: [],
    allComponents: allComponents,
    message: inputPartName
      ? 'Part Code หรือ Part Name ไม่ตรงกับ BOM ของเครื่อง ' + machineId
      : 'รหัส ' + partCode + ' ไม่ตรงกับ BOM ของสินค้าที่กำหนดให้เครื่อง ' + machineId
  };
}

function buildMaterialCodeCandidates(partCode) {
  var seeds = [];
  if (partCode) seeds.push(String(partCode));

  var seen = {};
  var out = [];

  seeds.forEach(function(code) {
    var trimmed = code.trim();
    if (!trimmed) return;

    var upper = trimmed.toUpperCase();
    var canonical = canonicalizeMaterialCode(trimmed);
    var noBoi = upper
      .replace(/\(BOI\)|-BOI$/i, '')
      .replace(/\(NON\)|-NON$/i, '')
      .trim();

    [upper, canonical, noBoi].forEach(function(v) {
      if (!v) return;
      if (!seen[v]) {
        seen[v] = true;
        out.push(v);
      }
    });
  });

  return expandWithMaterialAliases(out);
}

function canonicalizeMaterialCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isPartNameMatch(bomName, inputName) {
  var a = String(bomName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  var b = String(inputName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!a || !b) return false;
  return a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
}

function expandWithMaterialAliases(codes) {
  var aliasMap = getMaterialAliasIndex();
  if (!codes || codes.length === 0 || !aliasMap) return codes || [];

  var seen = {};
  var out = [];

  codes.forEach(function(code) {
    if (!code) return;
    var canonical = canonicalizeMaterialCode(code);

    if (!seen[code]) {
      seen[code] = true;
      out.push(code);
    }

    if (canonical && !seen[canonical]) {
      seen[canonical] = true;
      out.push(canonical);
    }

    var mapped = aliasMap[canonical] || [];
    mapped.forEach(function(aliasCanonical) {
      if (!seen[aliasCanonical]) {
        seen[aliasCanonical] = true;
        out.push(aliasCanonical);
      }
    });
  });

  return out;
}

// Built-in material code aliases (label code -> canonical BOM code).
// Extendable/overridable via the MaterialAlias sheet.
var DEFAULT_MATERIAL_ALIASES = [
  { alias: 'GHC11115AA', canonical: 'GHC11115A-BOI' }, // Tianjin JMT lug label = BOI variant
  { alias: '6108048', canonical: 'GHC11118A' }          // numeric screw code = GHC11118A
];

function getMaterialAliasIndex() {
  var index = {};

  function addAlias(aliasRaw, canonicalRaw) {
    var alias = canonicalizeMaterialCode(aliasRaw);
    var canonical = canonicalizeMaterialCode(canonicalRaw);
    if (!alias || !canonical) return;
    if (!index[alias]) index[alias] = [];
    if (index[alias].indexOf(canonical) === -1) index[alias].push(canonical);
  }

  // 1) Built-in defaults (always available)
  DEFAULT_MATERIAL_ALIASES.forEach(function(d) { addAlias(d.alias, d.canonical); });

  // 2) Optional sheet-defined aliases (additions/overrides)
  try {
    var rows = getAllRows('MaterialAlias');
    (rows || []).forEach(function(r) {
      if (r.Active !== '' && !isActiveValue(r.Active)) return;
      addAlias(r.AliasCode, r.CanonicalCode);
    });
  } catch (e) {
    // Backward compatible: if MaterialAlias sheet doesn't exist yet, defaults still apply
  }

  return index;
}

function isExactMaterialCodeMatch(componentCode, candidateCodes) {
  if (!componentCode || !candidateCodes || candidateCodes.length === 0) return false;
  var compCanonical = canonicalizeMaterialCode(componentCode);
  if (!compCanonical) return false;
  for (var i = 0; i < candidateCodes.length; i++) {
    if (canonicalizeMaterialCode(candidateCodes[i]) === compCanonical) return true;
  }
  return false;
}

function isMaterialCodeMatch(componentCode, candidateCodes) {
  if (!componentCode || !candidateCodes || candidateCodes.length === 0) return false;
  var compUpper = String(componentCode).toUpperCase().trim();
  var compCanonical = canonicalizeMaterialCode(componentCode);

  for (var i = 0; i < candidateCodes.length; i++) {
    var c = candidateCodes[i];
    var cCanonical = canonicalizeMaterialCode(c);
    if (!c) continue;
    if (compUpper.indexOf(c) !== -1 || c.indexOf(compUpper) !== -1) return true;
    if (cCanonical && (compCanonical.indexOf(cCanonical) !== -1 || cCanonical.indexOf(compCanonical) !== -1)) return true;
  }
  return false;
}

function ensureRawMaterialColumns() {
  ensureColumnExists('RawMaterialLog', 'Customer');
  ensureColumnExists('RawMaterialLog', 'NetWeight');
  ensureColumnExists('RawMaterialLog', 'GrossWeight');
  ensureColumnExists('RawMaterialLog', 'CartonNo');
  ensureColumnExists('RawMaterialLog', 'PackingDate');
}

function submitRawMaterial(token, data) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }

  if (!data.partCode || !data.quantity) {
    return { success: false, message: 'กรุณากรอกรหัสชิ้นส่วน (Part Code) และจำนวน' };
  }

  // Server-side BOM validation if machineId is provided
  if (data.machineId) {
    var bomCheck = validateRawMaterialForMachine(data.machineId, data.partCode, data.partName);
    if (!bomCheck.valid) {
      return { success: false, message: bomCheck.message };
    }
  }

  var now = new Date();
  var receiveId = 'RM-' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase();

  // Save photos to Google Drive (grayscale conversion done client-side)
  var photoUrls = '';
  if (data.photos && data.photos.length > 0) {
    var urls = [];
    for (var i = 0; i < data.photos.length; i++) {
      try {
        var url = savePhotoToDrive(data.photos[i], receiveId + '_' + (i + 1), 'RawMaterial');
        if (url) urls.push(url);
      } catch (e) {
        Logger.log('Photo save error: ' + e.message);
      }
    }
    photoUrls = urls.join(', ');
  }

  ensureRawMaterialColumns();
  appendRow('RawMaterialLog', {
    ReceiveID: receiveId,
    Timestamp: formatDate(now),
    Date: getWorkDate(now),
    ReceivedBy: user.employeeId,
    ReceiverName: user.name,
    MachineID: data.machineId || '',
    PartCode: data.partCode,
    SupplierCode: data.supplierCode || '',
    PartName: data.partName || '',
    Specification: data.specification || '',
    Quantity: Number(data.quantity) || 0,
    Unit: data.unit || 'PCS',
    LotNumber: data.lotNumber || '',
    Inspector: data.inspector || '',
    Customer: data.customer || '',
    NetWeight: data.netWeight || '',
    GrossWeight: data.grossWeight || '',
    CartonNo: data.cartonNo || '',
    PackingDate: data.packingDate || '',
    Remark: data.remark || '',
    Photos: photoUrls,
    Status: 'received'
  });

  return { success: true, receiveId: receiveId, message: 'บันทึกรับวัตถุดิบเรียบร้อย: ' + receiveId };
}

function getTodayRawMaterials(token) {
  var user = validateSession(token);
  if (!user) return [];

  var today = getWorkDate(new Date());
  var logs = findRows('RawMaterialLog', function(row) {
    return row.Date === today;
  });

  logs.sort(function(a, b) {
    return new Date(b.Timestamp) - new Date(a.Timestamp);
  });

  return logs;
}

function getRawMaterialHistory(token, filters) {
  var user = validateSession(token);
  if (!user) return [];

  var logs = getAllRows('RawMaterialLog');

  if (filters) {
    if (filters.dateFrom && filters.dateTo) {
      logs = logs.filter(function(log) {
        return log.Date >= filters.dateFrom && log.Date <= filters.dateTo;
      });
    }
    if (filters.partCode) {
      logs = logs.filter(function(log) {
        return log.PartCode === filters.partCode;
      });
    }
  }

  logs.sort(function(a, b) {
    return new Date(b.Timestamp) - new Date(a.Timestamp);
  });

  return logs;
}

/**
 * OCR using Google Drive API v3
 * Upload image → convert to Google Docs (OCR) → extract text → delete temp file
 * Requires: Google Drive API v3 (Advanced Service "Drive" enabled)
 */
function ocrWithDrive(token, data) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }

  if (!data.image) {
    return { success: false, message: 'ไม่พบรูปภาพ' };
  }

  try {
    // Extract base64 data
    var base64Data = data.image;
    if (base64Data.indexOf('data:') === 0) {
      base64Data = base64Data.split(',')[1];
    }

    var decoded = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(decoded, 'image/jpeg', 'ocr_temp.jpg');

    // Upload with OCR conversion using Drive API v3
    var metadata = {
      name: 'OCR_Temp_' + new Date().getTime(),
      mimeType: 'application/vnd.google-apps.document'
    };

    var form = blob;
    var file = Drive.Files.create(metadata, form, {
      ocr: true,
      ocrLanguage: 'en',
      fields: 'id'
    });

    // Read OCR text from the converted Google Doc
    var doc = DocumentApp.openById(file.id);
    var text = doc.getBody().getText();

    // Delete temp file
    DriveApp.getFileById(file.id).setTrashed(true);

    return { success: true, text: text };
  } catch (e) {
    Logger.log('OCR error: ' + e.message + ' | stack: ' + e.stack);
    return { success: false, message: 'OCR ล้มเหลว: ' + e.message };
  }
}

/**
 * Save base64 photo to Google Drive, returns shareable URL
 * @param {string} base64DataUrl - The base64 data URL of the image
 * @param {string} fileName - Name for the saved file
 * @param {string} [subfolder] - Optional subfolder name (e.g. ticket ID) for organization
 */
function savePhotoToDrive(base64DataUrl, fileName, subfolder) {
  try {
    var originalName = '';
    if (base64DataUrl && typeof base64DataUrl === 'object') {
      originalName = String(base64DataUrl.name || '');
      base64DataUrl = base64DataUrl.dataUrl || base64DataUrl.data || '';
    }

    // Validate input is a base64 data URL
    if (!base64DataUrl || typeof base64DataUrl !== 'string' || base64DataUrl.indexOf('data:') !== 0) {
      Logger.log('savePhotoToDrive: invalid input - not a data URL');
      return '';
    }

    // Extract base64 data from data URL
    var parts = base64DataUrl.split(',');
    if (parts.length < 2) {
      Logger.log('savePhotoToDrive: invalid data URL format');
      return '';
    }

    var contentType = parts[0].match(/:(.*?);/);
    contentType = contentType ? contentType[1] : 'image/jpeg';
    var base64Data = parts[1];
    var safeName = String(originalName || fileName || 'attachment').replace(/[\\/:*?"<>|]/g, '_');
    if (safeName.indexOf('.') === -1) {
      var extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'application/pdf': '.pdf', 'text/plain': '.txt' };
      safeName += extMap[contentType] || '';
    }

    var decoded = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(decoded, contentType, safeName);

    // Get or create target folder (with optional subfolder)
    var folder = getOrCreatePhotosFolder(subfolder);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var fileId = file.getId();
    if (contentType.indexOf('image/') === 0) {
      return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1200';
    }
    return 'https://drive.google.com/file/d/' + fileId + '/view';
  } catch (e) {
    Logger.log('savePhotoToDrive error: ' + e.message + ' | stack: ' + e.stack);
    return '';
  }
}

/**
 * Get or create the H1_Photos folder in Google Drive
 * Optionally creates a subfolder for better organization (e.g. per ticket)
 * Structure: H1_LugScrew_Photos / MT-20260322-A1B2C3 / photo.jpg
 * @param {string} [subfolder] - Optional subfolder name
 */
function getOrCreatePhotosFolder(subfolder) {
  var folderName = 'H1_LugScrew_Photos';
  var folders = DriveApp.getFoldersByName(folderName);
  var rootFolder;
  if (folders.hasNext()) {
    rootFolder = folders.next();
  } else {
    rootFolder = DriveApp.createFolder(folderName);
  }

  // If subfolder requested, create/get it inside root
  if (subfolder) {
    var subFolders = rootFolder.getFoldersByName(subfolder);
    if (subFolders.hasNext()) {
      return subFolders.next();
    }
    return rootFolder.createFolder(subfolder);
  }

  return rootFolder;
}
