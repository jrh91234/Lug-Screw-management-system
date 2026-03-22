/**
 * Utility functions for H1 Lug&Screw Production Management System
 */

function generateUUID() {
  return Utilities.getUuid();
}

function detectShift(date) {
  var hour = date.getHours();
  // Day shift: 08:00 - 19:59, Night shift: 20:00 - 07:59
  if (hour >= 8 && hour < 20) {
    return 'Day';
  }
  return 'Night';
}

/**
 * Detect time period from hour (hourly slots)
 * Returns format: "HH:00-HH:59"
 */
function detectTimePeriod(date) {
  var hour = date.getHours();
  var hh = ('0' + hour).slice(-2);
  return hh + ':00-' + hh + ':59';
}

function formatDate(date) {
  return Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
}

function formatDateOnly(date) {
  return Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd');
}

function parseDate(dateString) {
  return new Date(dateString);
}

function getThaiDate(date) {
  var months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  var d = date.getDate();
  var m = months[date.getMonth()];
  var y = date.getFullYear() + 543;
  return d + ' ' + m + ' ' + y;
}

function getTodayStart() {
  var now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function getTodayEnd() {
  var now = new Date();
  now.setHours(23, 59, 59, 999);
  return now;
}

function getWeekStart() {
  var now = new Date();
  var dayOfWeek = now.getDay();
  var diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  now.setDate(now.getDate() - diff);
  now.setHours(0, 0, 0, 0);
  return now;
}

function getMonthStart() {
  var now = new Date();
  now.setDate(1);
  now.setHours(0, 0, 0, 0);
  return now;
}
