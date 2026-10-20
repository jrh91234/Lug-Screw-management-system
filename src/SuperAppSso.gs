/**
 * Assembly Super App single sign-on.
 *
 * Script Property SUPERAPP_AUTH_URL must hold the central auth web app URL
 * (jrh91234/Assembly-super-app scr/auth.gs). The Super App username, upper-cased,
 * is the EmployeeID here: the Users row is created on first SSO login (empty PIN,
 * so PIN login stays off until an admin sets one) and its Name/Role follow the
 * central directory on every SSO login. After that a normal session is issued.
 */

var SUPERAPP_APP_ID = 'lug-screw';

function ssoLogin(ssoToken) {
  var verified = verifySuperAppToken_(ssoToken, SUPERAPP_APP_ID);
  if (!verified.success) return verified;

  var ssoUser = verified.user;
  var employeeId = String(ssoUser.username || '').trim().toUpperCase();
  if (!employeeId) return { success: false, message: 'ข้อมูลผู้ใช้จาก Super App ไม่ถูกต้อง' };
  var role = DEFAULT_PERMISSIONS[ssoUser.role] ? ssoUser.role : 'viewer';

  ensureUsersPermissionsColumn();
  var existing = findRow('Users', 'EmployeeID', employeeId);
  if (existing) {
    if (!isActiveValue(existing.Active)) {
      return { success: false, message: 'บัญชีถูกระงับ กรุณาติดต่อผู้ดูแล' };
    }
    updateRow('Users', 'EmployeeID', employeeId, { Name: ssoUser.name || existing.Name, Role: role });
  } else {
    appendRow('Users', {
      EmployeeID: employeeId,
      Name: ssoUser.name || employeeId,
      PIN: '',
      Role: role,
      Shift: '',
      Active: true,
      CreatedAt: formatDate(new Date()),
      Permissions: ''
    });
  }

  var user = findRow('Users', 'EmployeeID', employeeId);
  return {
    success: true,
    token: createSession(employeeId),
    user: {
      employeeId: user.EmployeeID,
      name: user.Name,
      role: user.Role,
      shift: user.Shift || '',
      permissions: getUserPermissions(user)
    }
  };
}

function verifySuperAppToken_(ssoToken, appId) {
  var url = PropertiesService.getScriptProperties().getProperty('SUPERAPP_AUTH_URL');
  if (!url) return { success: false, message: 'ยังไม่ได้ตั้งค่า SUPERAPP_AUTH_URL ใน Script Properties' };
  if (!ssoToken) return { success: false, message: 'ไม่พบ token ของ Super App' };

  var data;
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'text/plain',
      payload: JSON.stringify({ action: 'verify', token: ssoToken, app: appId }),
      muteHttpExceptions: true
    });
    data = JSON.parse(res.getContentText());
  } catch (err) {
    // ยังไม่ได้เพิ่ม/อนุญาต scope script.external_request ก็มาตกที่นี่ — login ด้วย PIN ยังใช้ได้
    return { success: false, message: 'ตรวจสอบกับ Super App ไม่สำเร็จ: ' + err.message };
  }
  if (!data || !data.success || !data.user) {
    return { success: false, message: (data && data.message) || 'ไม่มีสิทธิ์ใช้งานแอปนี้' };
  }
  return data;
}

/**
 * Run once from the Apps Script editor after deploying this file: SSO needs
 * UrlFetchApp (scope script.external_request), which the owner must approve.
 */
function authorizeSuperAppSso() {
  var url = PropertiesService.getScriptProperties().getProperty('SUPERAPP_AUTH_URL');
  if (!url) throw new Error('ตั้ง Script Property SUPERAPP_AUTH_URL ก่อน');
  Logger.log(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
}
