/**
 * Authentication and Session Management
 * Supports per-user permissions (override role defaults)
 */

// Default permissions by role
var DEFAULT_PERMISSIONS = {
  'viewer':      { production: false, inbox: true, maintenance: false, rawmaterial: false, machines: false, dashboard: true,  admin: false, cost: false, waste: false },
  'operator':    { production: true,  inbox: true, maintenance: true, rawmaterial: false, machines: true, dashboard: false, admin: false, cost: false, waste: true },
  'maintenance': { production: true,  inbox: true, maintenance: true, rawmaterial: true,  machines: true, dashboard: false, admin: false, cost: false, waste: true },
  'supervisor':  { production: true,  inbox: true, maintenance: true, rawmaterial: true,  machines: true, dashboard: true,  admin: false, cost: true,  waste: true },
  'admin':       { production: true,  inbox: true, maintenance: true, rawmaterial: true,  machines: true, dashboard: true,  admin: true, cost: true,  waste: true }
};

function ensureUsersPermissionsColumn() {
  ensureColumnExists('Users', 'Permissions');
}

function getDefaultPermissions(role) {
  return DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS['operator'];
}

function getUserPermissions(user) {
  return mergePermissionsForRole(user.Role, user.Permissions, user.EmployeeID);
}

function mergePermissionsForRole(role, customPermissions, employeeIdForLog) {
  var defaults = getDefaultPermissions(role);
  var merged = {};
  for (var dk in defaults) {
    merged[dk] = !!defaults[dk];
  }

  var custom = customPermissions;
  if (typeof customPermissions === 'string') {
    try {
      custom = JSON.parse(customPermissions);
    } catch (e) {
      Logger.log('Invalid permissions JSON for ' + (employeeIdForLog || '-') + ': ' + e.message);
      custom = null;
    }
  }

  if (custom && typeof custom === 'object') {
    for (var key in custom) {
      if (custom.hasOwnProperty(key)) {
        merged[key] = !!custom[key];
      }
    }
  }
  return merged;
}

function authenticateUser(employeeId, pin) {
  ensureUsersPermissionsColumn();
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
    'operator': 1,
    'viewer': 0
  };

  return (roleHierarchy[user.role] || 0) >= (roleHierarchy[requiredRole] || 0);
}

function getAllUsers(token) {
  ensureUsersPermissionsColumn();
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
  ensureUsersPermissionsColumn();
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
    permissions = JSON.stringify(mergePermissionsForRole(userData.role || 'operator', userData.permissions));
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
  ensureUsersPermissionsColumn();
  var user = validateSession(token);
  if (!user) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  }
  if (!hasRole(token, 'admin')) {
    return { success: false, message: 'ไม่มีสิทธิ์เข้าถึง' };
  }

  // If permissions object is provided, normalize with target role defaults first
  if (updates.Permissions && typeof updates.Permissions === 'object') {
    var existingUser = findRow('Users', 'EmployeeID', employeeId);
    var targetRole = updates.Role || (existingUser && existingUser.Role) || 'operator';
    updates.Permissions = JSON.stringify(mergePermissionsForRole(targetRole, updates.Permissions, employeeId));
  }

  var result = updateRow('Users', 'EmployeeID', employeeId, updates);
  if (result) {
    invalidateSessionsForEmployee(employeeId);
  }
  return { success: result };
}

function invalidateSessionsForEmployee(employeeId) {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var target = String(employeeId || '');

  for (var key in all) {
    if (key.indexOf('session_') !== 0) continue;
    try {
      var session = JSON.parse(all[key]);
      if (String(session.employeeId) === target) {
        props.deleteProperty(key);
      }
    } catch (e) {
      // Remove invalid session payloads
      props.deleteProperty(key);
    }
  }
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
