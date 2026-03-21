/**
 * Raw Material Receiving Service
 */

function submitRawMaterial(token, data) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }

  if (!data.partCode || !data.quantity) {
    return { success: false, message: 'กรุณากรอกรหัสชิ้นส่วนและจำนวน' };
  }

  var now = new Date();
  var receiveId = 'RM-' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase();

  // Save photos to Google Drive if provided
  var photoUrls = '';
  if (data.photos && data.photos.length > 0) {
    var urls = [];
    for (var i = 0; i < data.photos.length; i++) {
      try {
        var url = savePhotoToDrive(data.photos[i], receiveId + '_' + (i + 1));
        if (url) urls.push(url);
      } catch (e) {
        Logger.log('Photo save error: ' + e.message);
      }
    }
    photoUrls = urls.join(', ');
  }

  appendRow('RawMaterialLog', {
    ReceiveID: receiveId,
    Timestamp: formatDate(now),
    Date: formatDateOnly(now),
    ReceivedBy: user.employeeId,
    ReceiverName: user.name,
    PartCode: data.partCode,
    SupplierCode: data.supplierCode || '',
    PartName: data.partName || '',
    Specification: data.specification || '',
    Quantity: Number(data.quantity) || 0,
    Unit: data.unit || 'PCS',
    LotNumber: data.lotNumber || '',
    Inspector: data.inspector || '',
    Remark: data.remark || '',
    Photos: photoUrls,
    Status: 'received'
  });

  return { success: true, receiveId: receiveId, message: 'บันทึกรับวัตถุดิบเรียบร้อย: ' + receiveId };
}

function getTodayRawMaterials(token) {
  var user = validateSession(token);
  if (!user) return [];

  var today = formatDateOnly(new Date());
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
 * Save base64 photo to Google Drive, returns shareable URL
 */
function savePhotoToDrive(base64DataUrl, fileName) {
  try {
    // Extract base64 data from data URL
    var parts = base64DataUrl.split(',');
    if (parts.length < 2) return '';

    var contentType = parts[0].match(/:(.*?);/);
    contentType = contentType ? contentType[1] : 'image/jpeg';
    var base64Data = parts[1];

    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), contentType, fileName + '.jpg');

    // Get or create photos folder
    var folder = getOrCreatePhotosFolder();
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return file.getUrl();
  } catch (e) {
    Logger.log('savePhotoToDrive error: ' + e.message);
    return '';
  }
}

/**
 * Get or create the H1_Photos folder in Google Drive
 */
function getOrCreatePhotosFolder() {
  var folderName = 'H1_LugScrew_Photos';
  var folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(folderName);
}
