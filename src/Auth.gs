/**
 * Authentication and Session Management
 * Supports per-user permissions (override role defaults)
 */

// Default permissions by role
var DEFAULT_PERMISSIONS = {
  'operator':    { production: true, maintenance: true, rawmaterial: false, machines: true, dashboard: false, admin: false },
  'maintenance': { production: true, maintenance: true, rawmaterial: true,  machines: true, dashboard: false, admin: false },
  'supervisor':  { production: true, maintenance: true, rawmaterial: true,  machines: true, dashboard: true,  admin: false },
  'admin':       { production: true, maintenance: true, rawmaterial: true,  machines: true, dashboard: true,  admin: true }
};

function getDefaultPermissions(role) {
  return DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS['operator'];
}

function getUserPermissions(user) {
  var defaults = getDefaultPermissions(user.Role);
  // If user has custom permissions stored, merge them
  if (user.Permissions && String(user.Permissions).trim()) {
    try {
      var custom = JSON.parse(user.Permissions);
      // Custom permissions fully override defaults
      for (var key in defaults) {
        if (custom.hasOwnProperty(key)) {
          defaults[key] = custom[key];
        }
      }
    } catch (e) {
      Logger.log('Invalid permissions JSON for ' + user.EmployeeID + ': ' + e.message);
    }
  }
  return defaults;
}

function authenticateUser(employeeId, pin) {
  var user = findRow('Users', 'EmployeeID', employeeId);

  if (!user) {
    return { success: false, message: 'ไม่พบรหัสพนักงาน' };
  }

  if (!isActiveValue(user.Active)) {
    return { success: false, message: 'บัญชีถูกระงับ กรุณาติดต่อผู้ดูแล' };
  }

  if (String(user.PIN) !== String(pin)) {
    return { success: false, message: 'รหัส PIN ไม่ถูกต้อง' };
  }

  var token = createSession(employeeId);
  var permissions = getUserPermissions(user);

  return {
    success: true,
    token: token,
    user: {
      employeeId: user.EmployeeID,
      name: user.Name,
      role: user.Role,
      shift: user.Shift || '',
      permissions: permissions
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
    role: user.Role,
    shift: user.Shift || '',
    permissions: getUserPermissions(user)
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
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }
  if (!hasRole(token, 'admin')) {
    return { success: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  }

  var users = getAllRows('Users');
  return users.map(function(u) {
    return {
      employeeId: u.EmployeeID,
      name: u.Name,
      role: u.Role,
      shift: u.Shift || '',
      active: u.Active,
      permissions: getUserPermissions(u)
    };
  });
}

function addUser(token, userData) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }
  if (!hasRole(token, 'admin')) {
    return { success: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  }

  var existing = findRow('Users', 'EmployeeID', userData.employeeId);
  if (existing) {
    return { success: false, message: 'รหัสพนักงานซ้ำ' };
  }

  // Build initial permissions - use defaults or custom if provided
  var permissions = '';
  if (userData.permissions) {
    permissions = JSON.stringify(userData.permissions);
  }

  appendRow('Users', {
    EmployeeID: userData.employeeId,
    Name: userData.name,
    PIN: userData.pin,
    Role: userData.role || 'operator',
    Shift: userData.shift || '',
    Active: true,
    CreatedAt: formatDate(new Date()),
    Permissions: permissions
  });

  return { success: true };
}

function updateUser(token, employeeId, updates) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }
  if (!hasRole(token, 'admin')) {
    return { success: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  }

  // If permissions object is provided, stringify it
  if (updates.Permissions && typeof updates.Permissions === 'object') {
    updates.Permissions = JSON.stringify(updates.Permissions);
  }

  var result = updateRow('Users', 'EmployeeID', employeeId, updates);
  return { success: result };
}

function getDefaultPermissionsForRole(token, role) {
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }
  if (!hasRole(token, 'admin')) {
    return { success: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  }
  return getDefaultPermissions(role);
}
