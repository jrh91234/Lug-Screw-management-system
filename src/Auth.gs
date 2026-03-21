/**
 * Authentication and Session Management
 */

function authenticateUser(employeeId, pin) {
  var user = findRow('Users', 'EmployeeID', employeeId);

  if (!user) {
    return { success: false, message: 'ไม่พบรหัสพนักงาน' };
  }

  if (String(user.Active) !== 'TRUE' && user.Active !== true) {
    return { success: false, message: 'บัญชีถูกระงับ กรุณาติดต่อผู้ดูแล' };
  }

  if (String(user.PIN) !== String(pin)) {
    return { success: false, message: 'รหัส PIN ไม่ถูกต้อง' };
  }

  var token = createSession(employeeId);

  return {
    success: true,
    token: token,
    user: {
      employeeId: user.EmployeeID,
      name: user.Name,
      role: user.Role
    }
  };
}

function createSession(employeeId) {
  var token = generateUUID();
  var expiry = new Date();
  expiry.setHours(expiry.getHours() + 12);

  var props = PropertiesService.getScriptProperties();
  var sessionData = JSON.stringify({
    employeeId: employeeId,
    expiry: expiry.getTime()
  });

  props.setProperty('session_' + token, sessionData);
  return token;
}

function validateSession(token) {
  if (!token) return null;

  var props = PropertiesService.getScriptProperties();
  var sessionStr = props.getProperty('session_' + token);

  if (!sessionStr) return null;

  var session = JSON.parse(sessionStr);

  if (new Date().getTime() > session.expiry) {
    props.deleteProperty('session_' + token);
    return null;
  }

  var user = findRow('Users', 'EmployeeID', session.employeeId);
  if (!user) return null;

  return {
    employeeId: user.EmployeeID,
    name: user.Name,
    role: user.Role
  };
}

function logout(token) {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('session_' + token);
  return { success: true };
}

function getCurrentUser(token) {
  return validateSession(token);
}

function hasRole(token, requiredRole) {
  var user = validateSession(token);
  if (!user) return false;

  var roleHierarchy = {
    'admin': 4,
    'supervisor': 3,
    'maintenance': 2,
    'operator': 1
  };

  return (roleHierarchy[user.role] || 0) >= (roleHierarchy[requiredRole] || 0);
}

function getAllUsers(token) {
  if (!hasRole(token, 'admin')) {
    return { success: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  }

  var users = getAllRows('Users');
  return users.map(function(u) {
    return {
      employeeId: u.EmployeeID,
      name: u.Name,
      role: u.Role,
      active: u.Active
    };
  });
}

function addUser(token, userData) {
  if (!hasRole(token, 'admin')) {
    return { success: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  }

  var existing = findRow('Users', 'EmployeeID', userData.employeeId);
  if (existing) {
    return { success: false, message: 'รหัสพนักงานซ้ำ' };
  }

  appendRow('Users', {
    EmployeeID: userData.employeeId,
    Name: userData.name,
    PIN: userData.pin,
    Role: userData.role || 'operator',
    Active: true,
    CreatedAt: formatDate(new Date())
  });

  return { success: true };
}

function updateUser(token, employeeId, updates) {
  if (!hasRole(token, 'admin')) {
    return { success: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  }

  var result = updateRow('Users', 'EmployeeID', employeeId, updates);
  return { success: result };
}
