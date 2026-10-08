/**
 * Sorting Rounds — per-person, per-shift record of sorting work, for sorter KPIs.
 *
 * A round is one stretch of sitting down and sorting one job: it opens when the sorter
 * presses "เริ่มคัด" and closes when they stop and enter what they sorted in that
 * stretch. Its quantities go onto the job's running totals in SortingLog exactly as a
 * recorded result always has (applySortingIncrement), so SortingLog stays the job
 * summary and the sorting dashboard is unchanged. A job sorted over several shifts or
 * by several people is several rounds, each credited to whoever sorted it.
 *
 * The sorter also weighs sales orders (ชั่งงานขาย) and does other jobs during a shift.
 * That time is logged as SorterActivity so it is taken out of the sorting time instead
 * of making the sorter look slow. Nothing is counted for it — only minutes.
 *
 * One person has at most one thing open at a time: a round or an activity.
 *
 * A round or activity left open past the end of its shift is closed by the system at
 * the shift end and flagged 'auto-closed' (the shift did not hand over). An auto-closed
 * round has no quantities; its owner or a supervisor fills them in once with
 * fillSortingRound. A round entered in error is voided (supervisor), never deleted, so
 * its production adjustment is reversed with an audit trail.
 *
 * The whole feature is switched on from a start time (SORTING_ROUNDS_START, set by a
 * supervisor on the report tab). Until then — and whenever it is unset — the sorting
 * page and recordSortingResult work exactly as they did before rounds existed, and every
 * round/activity action refuses, so it can be deployed ahead of training the sorters.
 *
 * Before go-live an admin gets the round flow anyway, as a test mode: everything they
 * do is flagged 'test' and posts nothing to ProductionLog (job totals in SortingLog do
 * move, so test on a job registered as งานทดสอบ). Voiding or filling a test round
 * leaves ProductionLog alone too.
 */

var SORTING_ROUND_HEADERS = ['RoundID', 'Timestamp', 'WorkDate', 'Shift', 'ShiftDN', 'JobID', 'EmployeeID', 'EmployeeName',
  'StartAt', 'EndAt', 'Minutes', 'GoodQty', 'DefectLug', 'DefectScrew', 'DefectScrewLug', 'ProductCode', 'MachineID',
  'FoundProcess', 'StopReason', 'Flag', 'Status', 'ProdAdjLogID', 'Remark', 'VoidedBy', 'VoidedAt', 'VoidReason'];

var SORTER_ACTIVITY_HEADERS = ['ActivityID', 'Timestamp', 'WorkDate', 'Shift', 'ShiftDN', 'EmployeeID', 'EmployeeName',
  'Type', 'StartAt', 'EndAt', 'Minutes', 'Flag', 'Remark'];

// Activity types the sorter can step away for. Stored as the Thai label so the sheet
// reads on its own.
var SORTER_ACTIVITY_TYPES = { weigh: 'ชั่งงานขาย', other: 'งานอื่นๆ' };

// Why a round ended. 'weigh' / 'other' also open the matching activity.
var SORTING_STOP_REASONS = {
  checkpoint: 'บันทึกยอดระหว่างทาง',
  weigh: 'ไปชั่งงานขาย',
  other: 'ไปทำงานอื่น',
  'break': 'พัก',
  handover: 'จบกะ/ส่งต่อ',
  done: 'งานเสร็จ',
  auto: 'ระบบปิดเมื่อจบกะ'
};

var SORTING_TARGET_PROPERTY = 'SORTING_TARGET_PCS_PER_HR';
var SORTING_ROUNDS_START_PROPERTY = 'SORTING_ROUNDS_START';
var SORTING_ROUNDS_OFF_MESSAGE = 'ระบบจับเวลาคัดยังไม่เปิดใช้งาน';

/** The configured go-live time ('yyyy-MM-dd HH:mm:ss' Bangkok), or '' when off. */
function getSortingRoundsStart() {
  return PropertiesService.getScriptProperties().getProperty(SORTING_ROUNDS_START_PROPERTY) || '';
}

function isSortingRoundsEnabled(now) {
  var start = parseBangkokStamp(getSortingRoundsStart());
  return !!start && (now || new Date()).getTime() >= start.getTime();
}

/** 'live' once rounds have gone live, 'test' for an admin before that, else 'off'. */
function getSortingRoundsMode(user, now) {
  if (isSortingRoundsEnabled(now)) return 'live';
  return user && user.role === 'admin' ? 'test' : 'off';
}

function isTestRound(r) {
  return String((r && r.Flag) || '').indexOf('test') !== -1;
}

/**
 * Set when rounds go live. startAt: 'yyyy-MM-dd HH:mm' (Bangkok); '' switches it off and
 * puts the page back on the old flow. Supervisor only.
 */
function setSortingRoundsStart(token, startAt) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!isSupervisorUser(user)) return { success: false, message: 'เฉพาะหัวหน้างานเท่านั้น' };
  var props = PropertiesService.getScriptProperties();
  var raw = String(startAt || '').trim();
  if (!raw) {
    props.deleteProperty(SORTING_ROUNDS_START_PROPERTY);
    return { success: true, startAt: '', enabled: false, message: 'ปิดระบบจับเวลาคัดแล้ว — กลับไปใช้แบบเดิม' };
  }
  var start = parseBangkokStamp(raw.replace('T', ' '));
  if (!start) return { success: false, message: 'วันเวลาไม่ถูกต้อง' };
  var stamp = formatDate(start);
  props.setProperty(SORTING_ROUNDS_START_PROPERTY, stamp);
  var enabled = isSortingRoundsEnabled();
  return {
    success: true, startAt: stamp, enabled: enabled,
    message: enabled ? 'เปิดระบบจับเวลาคัดแล้ว' : 'ตั้งเวลาเปิดระบบจับเวลาคัด: ' + stamp.substring(0, 16)
  };
}

function ensureSortingRoundSheets() {
  ensureSheetExists('SortingRounds', SORTING_ROUND_HEADERS);
  ensureSheetExists('SorterActivity', SORTER_ACTIVITY_HEADERS);
}

function newSortingRoundId(now) {
  return 'SR-' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase();
}

function newSorterActivityId(now) {
  return 'SA-' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd') + '-' + generateUUID().substring(0, 6).toUpperCase();
}

/** Parse a 'yyyy-MM-dd HH:mm:ss' Bangkok timestamp as written by formatDate(). */
function parseBangkokStamp(stamp) {
  var s = String(stamp || '').trim();
  if (!s) return null;
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  var ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)) - BANGKOK_OFFSET_MS;
  return new Date(ms);
}

function minutesBetween(from, to) {
  if (!from || !to) return 0;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
}

/**
 * When the shift a round or activity started in is over: 20:00 of the work date for a
 * day shift, 08:00 of the next day for a night shift (same boundaries as detectShift).
 */
function getShiftEndFor(workDate, shiftDN) {
  var dayStart = parseBangkokStamp(String(workDate) + ' 00:00:00');
  if (!dayStart) return null;
  var hours = String(shiftDN) === 'Night' ? 32 : 20;
  return new Date(dayStart.getTime() + hours * 60 * 60 * 1000);
}

function isSupervisorUser(user) {
  return !!user && (user.role === 'admin' || user.role === 'supervisor');
}

/**
 * Close every round and activity whose shift has ended while it was still open. The
 * end time is the shift end, not now, so a forgotten round does not soak up the gap
 * until someone next opens the page. Returns how many were closed.
 */
function closeStaleSorterSessions(now) {
  now = now || new Date();
  var closed = 0;

  findRows('SortingRounds', function(r) { return String(r.Status) === 'open'; }).forEach(function(r) {
    var end = getShiftEndFor(r.WorkDate, r.ShiftDN);
    if (!end || end.getTime() > now.getTime()) return;
    updateRow('SortingRounds', 'RoundID', r.RoundID, {
      EndAt: formatDate(end),
      Minutes: minutesBetween(parseBangkokStamp(r.StartAt), end),
      StopReason: 'auto',
      Flag: 'auto-closed',
      Status: 'closed'
    });
    closed++;
  });

  findRows('SorterActivity', function(a) { return !a.EndAt; }).forEach(function(a) {
    var end = getShiftEndFor(a.WorkDate, a.ShiftDN);
    if (!end || end.getTime() > now.getTime()) return;
    updateRow('SorterActivity', 'ActivityID', a.ActivityID, {
      EndAt: formatDate(end),
      Minutes: minutesBetween(parseBangkokStamp(a.StartAt), end),
      Flag: 'auto-closed'
    });
    closed++;
  });

  return closed;
}

function findOpenRoundFor(employeeId) {
  var rows = findRows('SortingRounds', function(r) {
    return String(r.Status) === 'open' && String(r.EmployeeID) === String(employeeId);
  });
  return rows.length ? rows[0] : null;
}

function findOpenActivityFor(employeeId) {
  var rows = findRows('SorterActivity', function(a) {
    return !a.EndAt && String(a.EmployeeID) === String(employeeId);
  });
  return rows.length ? rows[0] : null;
}

function closeActivityRow(activity, now) {
  updateRow('SorterActivity', 'ActivityID', activity.ActivityID, {
    EndAt: formatDate(now),
    Minutes: minutesBetween(parseBangkokStamp(activity.StartAt), now)
  });
}

function openActivityRow(user, type, shift, remark, now, isTest) {
  var activityId = newSorterActivityId(now);
  appendRow('SorterActivity', {
    ActivityID: activityId,
    Timestamp: formatDate(now),
    WorkDate: getWorkDate(now),
    Shift: shift || user.shift || '',
    ShiftDN: detectShift(now),
    EmployeeID: user.employeeId,
    EmployeeName: user.name,
    Type: SORTER_ACTIVITY_TYPES[type],
    StartAt: formatDate(now),
    EndAt: '',
    Minutes: '',
    Flag: isTest ? 'test' : '',
    Remark: remark || ''
  });
  return activityId;
}

/**
 * What the signed-in sorter has open right now, the rounds of theirs still waiting
 * for quantities, and who is sorting which job (so the page can show it on the cards).
 */
function getSorterState(token) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  var now = new Date();
  var startAt = getSortingRoundsStart();
  var mode = getSortingRoundsMode(user, now);
  if (mode === 'off') {
    return { success: true, enabled: false, testMode: false, startAt: startAt, serverTime: formatDate(now),
             openRound: null, openActivity: null, openByJob: {}, needFill: [] };
  }

  ensureSortingRoundSheets();
  closeStaleSorterSessions(now);

  var rounds = getAllRows('SortingRounds');
  var openRound = null;
  var openByJob = {};
  var needFill = [];
  rounds.forEach(function(r) {
    if (String(r.Status) === 'open') {
      openByJob[r.JobID] = { roundId: r.RoundID, employeeId: r.EmployeeID, employeeName: r.EmployeeName, startAt: r.StartAt };
      if (String(r.EmployeeID) === String(user.employeeId)) openRound = r;
    } else if (String(r.Status) === 'closed' && isUnfilledAutoRound(r) &&
               (String(r.EmployeeID) === String(user.employeeId) || isSupervisorUser(user))) {
      needFill.push(r);
    }
  });

  var openActivity = findOpenActivityFor(user.employeeId);

  return {
    success: true,
    enabled: true,
    testMode: mode === 'test',
    startAt: startAt,
    serverTime: formatDate(now),
    openRound: openRound,
    openActivity: openActivity,
    openByJob: openByJob,
    needFill: needFill
  };
}

function isUnfilledAutoRound(r) {
  return String(r.Flag || '').indexOf('auto-closed') !== -1 &&
    String(r.Flag || '').indexOf('filled') === -1 &&
    (Number(r.GoodQty) || 0) === 0 && (Number(r.DefectLug) || 0) === 0 &&
    (Number(r.DefectScrew) || 0) === 0 && (Number(r.DefectScrewLug) || 0) === 0;
}

/**
 * Open a round on a job for the signed-in sorter. Coming back from weighing / other
 * work closes that activity first. The job is claimed (in-progress) like pulling it.
 */
function startSortingRound(token, jobId, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  var mode = getSortingRoundsMode(user);
  if (mode === 'off') return { success: false, message: SORTING_ROUNDS_OFF_MESSAGE };

  ensureSortingColumns();
  ensureSortingRoundSheets();
  var now = new Date();
  closeStaleSorterSessions(now);

  var job = findRow('SortingLog', 'JobID', jobId);
  if (!job) return { success: false, message: 'ไม่พบงาน sort: ' + jobId };
  if (String(job.Status) === 'completed') return { success: false, message: 'งานนี้คัดแยกเสร็จแล้ว' };

  var mine = findOpenRoundFor(user.employeeId);
  if (mine) {
    return { success: false, message: 'คุณยังมีรอบที่เปิดอยู่ (' + mine.JobID + ') — กรุณาหยุดและบันทึกยอดก่อน' };
  }
  var othersOnJob = findRows('SortingRounds', function(r) {
    return String(r.Status) === 'open' && String(r.JobID) === String(jobId);
  });
  if (othersOnJob.length) {
    return { success: false, message: 'งานนี้กำลังคัดโดย ' + (othersOnJob[0].EmployeeName || othersOnJob[0].EmployeeID) };
  }

  var activity = findOpenActivityFor(user.employeeId);
  if (activity) closeActivityRow(activity, now);

  var shift = (data && data.shift) || user.shift || job.Shift || '';
  var stamp = formatDate(now);
  var roundId = newSortingRoundId(now);
  appendRow('SortingRounds', {
    RoundID: roundId,
    Timestamp: stamp,
    WorkDate: getWorkDate(now),
    Shift: shift,
    ShiftDN: detectShift(now),
    JobID: job.JobID,
    EmployeeID: user.employeeId,
    EmployeeName: user.name,
    StartAt: stamp,
    EndAt: '',
    Minutes: '',
    GoodQty: 0,
    DefectLug: 0,
    DefectScrew: 0,
    DefectScrewLug: 0,
    ProductCode: job.ProductCode || '',
    MachineID: job.MachineID || '',
    FoundProcess: job.FoundProcess || '',
    StopReason: '',
    Flag: mode === 'test' ? 'test' : '',
    Status: 'open',
    ProdAdjLogID: '',
    Remark: ''
  });

  var changes = { Status: 'in-progress', SortedBy: user.employeeId, SortedByName: user.name };
  if (!job.PulledAt) changes.PulledAt = stamp;
  updateRow('SortingLog', 'JobID', job.JobID, changes);

  return { success: true, roundId: roundId, message: 'เริ่มคัดงาน ' + job.JobID };
}

/**
 * Close the signed-in sorter's open round with what they sorted in it.
 * data: { goodQty, defectLug, defectScrew, defectScrewLug, remark, reason, shift }
 *   reason 'checkpoint' — record so far and keep sorting (a new round opens at once)
 *   reason 'weigh' / 'other' — stepping away; the matching activity opens at once
 *   reason 'break' / 'handover' — just stop
 * A round that fills the job closes it as 'done' whatever the reason.
 * Zero quantities are allowed (called away a minute in): the time still counts.
 */
function stopSortingRound(token, roundId, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  var mode = getSortingRoundsMode(user);
  if (mode === 'off') return { success: false, message: SORTING_ROUNDS_OFF_MESSAGE };

  ensureSortingColumns();
  ensureSortingRoundSheets();
  data = data || {};
  var reason = String(data.reason || '');
  if (!SORTING_STOP_REASONS[reason] || reason === 'auto' || reason === 'done') {
    return { success: false, message: 'กรุณาเลือกเหตุผลที่หยุด' };
  }

  var round = findRow('SortingRounds', 'RoundID', roundId);
  if (!round) return { success: false, message: 'ไม่พบรอบงาน: ' + roundId };
  if (String(round.Status) !== 'open') return { success: false, message: 'รอบนี้ปิดไปแล้ว' };
  if (String(round.EmployeeID) !== String(user.employeeId)) {
    return { success: false, message: 'รอบนี้เป็นของ ' + (round.EmployeeName || round.EmployeeID) };
  }

  var inc = readSortingIncrement(data);
  if (inc.error) return { success: false, message: inc.error };

  var job = findRow('SortingLog', 'JobID', round.JobID);
  if (!job) return { success: false, message: 'ไม่พบงาน sort: ' + round.JobID };

  var now = new Date();
  var applied = null;
  if (inc.good > 0 || inc.defect > 0) {
    applied = applySortingIncrement(user, job, inc, data.remark, { skipProduction: isTestRound(round) });
  }
  var jobDone = applied && applied.status === 'completed';

  updateRow('SortingRounds', 'RoundID', roundId, {
    EndAt: formatDate(now),
    Minutes: minutesBetween(parseBangkokStamp(round.StartAt), now),
    GoodQty: inc.good,
    DefectLug: inc.lug,
    DefectScrew: inc.screw,
    DefectScrewLug: inc.screwLug,
    StopReason: jobDone ? 'done' : reason,
    Status: 'closed',
    ProdAdjLogID: (applied && applied.adj.logId) || '',
    Remark: data.remark || ''
  });

  var next = '';
  var shift = data.shift || round.Shift || '';
  if (reason === 'weigh' || reason === 'other') {
    openActivityRow(user, reason, shift, '', now, isTestRound(round));
    next = 'activity';
  } else if (reason === 'checkpoint' && !jobDone) {
    var reopened = startSortingRound(token, round.JobID, { shift: shift });
    if (reopened.success) next = 'round';
  }

  var msg = jobDone ? 'บันทึกยอดแล้ว — งานเสร็จสมบูรณ์' : 'บันทึกยอดรอบนี้แล้ว';
  if (next === 'activity') msg += ' — เริ่มจับเวลา' + SORTER_ACTIVITY_TYPES[reason];
  if (next === 'round') msg += ' — เริ่มรอบใหม่ต่อ';
  if (applied && applied.adj.adjusted) msg += ' (ปรับยอดผลิตแล้ว)';

  return { success: true, status: applied ? applied.status : String(job.Status), next: next, message: msg };
}

/** Step away to weigh sales orders / other work while no round is open. */
function startSorterActivity(token, type, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  var mode = getSortingRoundsMode(user);
  if (mode === 'off') return { success: false, message: SORTING_ROUNDS_OFF_MESSAGE };
  if (!SORTER_ACTIVITY_TYPES[type]) return { success: false, message: 'ประเภทกิจกรรมไม่ถูกต้อง' };

  ensureSortingRoundSheets();
  var now = new Date();
  closeStaleSorterSessions(now);

  var round = findOpenRoundFor(user.employeeId);
  if (round) return { success: false, message: 'กรุณาหยุดรอบคัดงาน ' + round.JobID + ' และบันทึกยอดก่อน' };
  var current = findOpenActivityFor(user.employeeId);
  if (current) {
    if (current.Type === SORTER_ACTIVITY_TYPES[type]) return { success: true, message: 'กำลังจับเวลา' + current.Type + 'อยู่แล้ว' };
    closeActivityRow(current, now);
  }

  openActivityRow(user, type, data && data.shift, data && data.remark, now, mode === 'test');
  return { success: true, message: 'เริ่มจับเวลา' + SORTER_ACTIVITY_TYPES[type] };
}

/** Come back from weighing / other work without starting a round. */
function stopSorterActivity(token) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  var mode = getSortingRoundsMode(user);
  if (mode === 'off') return { success: false, message: SORTING_ROUNDS_OFF_MESSAGE };

  ensureSortingRoundSheets();
  var activity = findOpenActivityFor(user.employeeId);
  if (!activity) return { success: false, message: 'ไม่มีกิจกรรมที่กำลังจับเวลา' };
  closeActivityRow(activity, new Date());
  return { success: true, message: 'จบ' + activity.Type + 'แล้ว' };
}

/**
 * Enter the quantities of a round the system closed at the shift end. Once only, by the
 * round's owner or a supervisor; the time stays what the system recorded.
 */
function fillSortingRound(token, roundId, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  var mode = getSortingRoundsMode(user);
  if (mode === 'off') return { success: false, message: SORTING_ROUNDS_OFF_MESSAGE };

  ensureSortingColumns();
  ensureSortingRoundSheets();
  var round = findRow('SortingRounds', 'RoundID', roundId);
  if (!round) return { success: false, message: 'ไม่พบรอบงาน: ' + roundId };
  if (String(round.Status) !== 'closed' || !isUnfilledAutoRound(round)) {
    return { success: false, message: 'รอบนี้กรอกยอดไม่ได้' };
  }
  if (String(round.EmployeeID) !== String(user.employeeId) && !isSupervisorUser(user)) {
    return { success: false, message: 'เฉพาะเจ้าของรอบหรือหัวหน้างานเท่านั้น' };
  }

  var inc = readSortingIncrement(data);
  if (inc.error) return { success: false, message: inc.error };
  if (inc.good === 0 && inc.defect === 0) return { success: false, message: 'กรุณากรอกจำนวนอย่างน้อย 1 ช่อง' };

  var job = findRow('SortingLog', 'JobID', round.JobID);
  if (!job) return { success: false, message: 'ไม่พบงาน sort: ' + round.JobID };

  // Credit the production adjustment to the round's sorter, not whoever typed it in.
  var owner = { employeeId: round.EmployeeID, name: round.EmployeeName, shift: round.Shift };
  var applied = applySortingIncrement(owner, job, inc, data && data.remark, { skipProduction: isTestRound(round) });

  updateRow('SortingRounds', 'RoundID', roundId, {
    GoodQty: inc.good,
    DefectLug: inc.lug,
    DefectScrew: inc.screw,
    DefectScrewLug: inc.screwLug,
    Flag: (isTestRound(round) ? 'test,' : '') + 'auto-closed,filled',
    StopReason: applied.status === 'completed' ? 'done' : round.StopReason,
    ProdAdjLogID: applied.adj.logId || '',
    Remark: ((data && data.remark) || '') + (String(round.EmployeeID) !== String(user.employeeId) ? ' (กรอกโดย ' + user.name + ')' : '')
  });

  return { success: true, status: applied.status, message: 'กรอกยอดรอบ ' + roundId + ' แล้ว' };
}

/**
 * Take a round back out (entered in error). Supervisor only. Its quantities come off the
 * job and its production adjustment is reversed with an opposite adjustment row.
 */
function voidSortingRound(token, roundId, reason) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!isSupervisorUser(user)) return { success: false, message: 'เฉพาะหัวหน้างานเท่านั้น' };
  if (!reason || !String(reason).trim()) return { success: false, message: 'กรุณาระบุเหตุผล' };

  ensureSortingColumns();
  ensureSortingRoundSheets();
  var round = findRow('SortingRounds', 'RoundID', roundId);
  if (!round) return { success: false, message: 'ไม่พบรอบงาน: ' + roundId };
  if (String(round.Status) !== 'closed') return { success: false, message: 'ยกเลิกได้เฉพาะรอบที่ปิดแล้ว' };

  var inc = {
    good: -(Number(round.GoodQty) || 0),
    lug: -(Number(round.DefectLug) || 0),
    screw: -(Number(round.DefectScrew) || 0),
    screwLug: -(Number(round.DefectScrewLug) || 0)
  };
  inc.defect = inc.lug + inc.screw + inc.screwLug;

  var adjLogId = '';
  if (inc.good !== 0 || inc.defect !== 0) {
    var job = findRow('SortingLog', 'JobID', round.JobID);
    if (job) {
      var owner = { employeeId: round.EmployeeID, name: round.EmployeeName, shift: round.Shift };
      adjLogId = applySortingIncrement(owner, job, inc, undefined, { skipProduction: isTestRound(round) }).adj.logId || '';
    }
  }

  updateRow('SortingRounds', 'RoundID', roundId, {
    Status: 'void',
    VoidedBy: user.name,
    VoidedAt: formatDate(new Date()),
    VoidReason: String(reason).trim() + (adjLogId ? ' [กลับรายการ ' + adjLogId + ']' : '')
  });
  return { success: true, message: 'ยกเลิกรอบ ' + roundId + ' แล้ว' };
}

/** Rounds of one job, oldest first — shown when a job card is expanded. */
function getSortingRounds(token, filters) {
  var user = validateSession(token);
  if (!user) return [];
  ensureSortingRoundSheets();
  filters = filters || {};
  var rows = findRows('SortingRounds', function(r) {
    if (filters.jobId && String(r.JobID) !== String(filters.jobId)) return false;
    if (filters.date && String(r.WorkDate) !== String(filters.date)) return false;
    return true;
  });
  rows.sort(function(a, b) { return String(a.StartAt).localeCompare(String(b.StartAt)); });
  return rows;
}

function getSortingTarget() {
  var v = Number(PropertiesService.getScriptProperties().getProperty(SORTING_TARGET_PROPERTY));
  return v > 0 ? v : 0;
}

/** Pieces-per-hour target shown on the shift report. Supervisor only; 0 clears it. */
function setSortingTarget(token, value) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!isSupervisorUser(user)) return { success: false, message: 'เฉพาะหัวหน้างานเท่านั้น' };
  var n = Number(value);
  if (isNaN(n) || n < 0) return { success: false, message: 'เป้าหมายไม่ถูกต้อง' };
  var props = PropertiesService.getScriptProperties();
  if (n > 0) props.setProperty(SORTING_TARGET_PROPERTY, String(Math.round(n)));
  else props.deleteProperty(SORTING_TARGET_PROPERTY);
  return { success: true, target: n > 0 ? Math.round(n) : 0, message: 'บันทึกเป้าหมายแล้ว' };
}

/**
 * Daily sorter report for one work date and (optionally) one crew A/B and Day/Night.
 * filters: { date: 'yyyy-MM-dd', shift: 'A'|'B'|'', shiftDN: 'Day'|'Night'|'' }
 *
 * Pieces per hour = pieces sorted in timed rounds ÷ the minutes of those rounds. Manual
 * rounds (no timer) count toward pieces but not toward the rate, and so do auto-closed
 * rounds (their time runs to the shift end, not to when sorting stopped) — their minutes
 * are reported apart as autoMinutes rather than as sorting time.
 */
function getSortingShiftReport(token, filters) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

  ensureSortingColumns();
  ensureSortingRoundSheets();
  filters = filters || {};
  var date = String(filters.date || getWorkDate(new Date()));
  var shift = String(filters.shift || '');
  var shiftDN = String(filters.shiftDN || '');
  var now = new Date();
  closeStaleSorterSessions(now);

  var inScope = function(r) {
    if (String(r.WorkDate) !== date) return false;
    if (shift && String(r.Shift) !== shift) return false;
    if (shiftDN && String(r.ShiftDN) !== shiftDN) return false;
    return true;
  };

  var rounds = findRows('SortingRounds', function(r) { return String(r.Status) !== 'void' && inScope(r); });
  var activities = findRows('SorterActivity', inScope);
  rounds.sort(function(a, b) { return String(a.StartAt).localeCompare(String(b.StartAt)); });
  activities.sort(function(a, b) { return String(a.StartAt).localeCompare(String(b.StartAt)); });

  var people = {};
  var person = function(id, name) {
    if (!people[id]) {
      people[id] = {
        employeeId: id, employeeName: name || id,
        rounds: 0, sortMinutes: 0, autoMinutes: 0, timedMinutes: 0, timedPieces: 0,
        good: 0, lug: 0, screw: 0, screwLug: 0, pieces: 0,
        weighMinutes: 0, otherMinutes: 0,
        manualRounds: 0, autoClosed: 0, unfilledRounds: 0, openNow: 0,
        jobsCompleted: 0
      };
    }
    return people[id];
  };

  var jobIds = {};
  rounds.forEach(function(r) {
    var p = person(r.EmployeeID, r.EmployeeName);
    var flag = String(r.Flag || '');
    var isOpen = String(r.Status) === 'open';
    var minutes = isOpen ? minutesBetween(parseBangkokStamp(r.StartAt), now) : (Number(r.Minutes) || 0);
    var pieces = (Number(r.GoodQty) || 0) + (Number(r.DefectLug) || 0) + (Number(r.DefectScrew) || 0) + (Number(r.DefectScrewLug) || 0);
    r.liveMinutes = minutes;
    r.pieces = pieces;
    p.rounds++;
    p.good += Number(r.GoodQty) || 0;
    p.lug += Number(r.DefectLug) || 0;
    p.screw += Number(r.DefectScrew) || 0;
    p.screwLug += Number(r.DefectScrewLug) || 0;
    p.pieces += pieces;
    if (flag.indexOf('manual') !== -1) p.manualRounds++;
    else if (flag.indexOf('auto-closed') !== -1) p.autoMinutes += minutes;
    else p.sortMinutes += minutes;
    if (flag.indexOf('auto-closed') !== -1) p.autoClosed++;
    if (isUnfilledAutoRound(r)) p.unfilledRounds++;
    if (isOpen) p.openNow++;
    if (flag.indexOf('manual') === -1 && flag.indexOf('auto-closed') === -1 && !isOpen) {
      p.timedMinutes += minutes;
      p.timedPieces += pieces;
    }
    if (String(r.StopReason) === 'done') p.jobsCompleted++;
    jobIds[r.JobID] = true;
  });

  activities.forEach(function(a) {
    var p = person(a.EmployeeID, a.EmployeeName);
    var minutes = a.EndAt ? (Number(a.Minutes) || 0) : minutesBetween(parseBangkokStamp(a.StartAt), now);
    a.liveMinutes = minutes;
    if (a.Type === SORTER_ACTIVITY_TYPES.weigh) p.weighMinutes += minutes;
    else p.otherMinutes += minutes;
    if (String(a.Flag || '').indexOf('auto-closed') !== -1) p.autoClosed++;
  });

  var target = getSortingTarget();
  var summary = Object.keys(people).map(function(id) {
    var p = people[id];
    p.pcsPerHour = p.timedMinutes > 0 ? Math.round(p.timedPieces / p.timedMinutes * 60) : 0;
    p.targetPct = target > 0 && p.timedMinutes > 0 ? Math.round(p.pcsPerHour / target * 100) : null;
    var rates = partNgRates(p.good, p.lug + p.screwLug, p.screw + p.screwLug);
    p.ngRate = p.pieces > 0 ? Number(rates.rate).toFixed(2) : '0.00';
    return p;
  });
  summary.sort(function(a, b) { return String(a.employeeName).localeCompare(String(b.employeeName)); });

  // Jobs worked in this shift plus everything still waiting, as of now.
  var jobs = findRows('SortingLog', function(j) {
    var st = String(j.Status || '');
    return jobIds[j.JobID] || ((st === 'pending' || st === 'in-progress') && String(j.Date) <= date);
  }).map(function(j) {
    var sorted = (Number(j.GoodQty) || 0) + (Number(j.DefectQty) || 0);
    var total = Number(j.TotalQty) || 0;
    return {
      jobId: j.JobID, date: j.Date, machineId: j.MachineID, productCode: j.ProductCode,
      foundProcess: j.FoundProcess, status: j.Status, totalQty: total, sorted: sorted,
      remaining: Math.max(0, total - sorted), workedThisShift: !!jobIds[j.JobID]
    };
  });
  jobs.sort(function(a, b) { return String(a.jobId).localeCompare(String(b.jobId)); });

  return {
    success: true,
    generatedAt: formatDate(now),
    filters: { date: date, shift: shift, shiftDN: shiftDN },
    target: target,
    stopReasons: SORTING_STOP_REASONS,
    summary: summary,
    rounds: rounds,
    activities: activities,
    jobs: jobs
  };
}
