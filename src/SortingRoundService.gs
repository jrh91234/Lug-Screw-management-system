/**
 * Sorting KPI — per-person, per-shift record of sorting work, for sorter KPIs.
 *
 * There is no timer. The sorter pulls and records results as always; each recorded
 * result is also logged as a row in SortingRounds (who, when, which job, what pieces),
 * on top of going onto the job's running totals in SortingLog (applySortingIncrement).
 * The time behind the pieces is the shift itself: the shift report takes the shift's
 * minutes, less the break schedule, less time logged away, less minutes when no job was
 * waiting, and sets the pieces recorded in the shift against what is left.
 *
 * The sorter also weighs sales orders (ชั่งงานขาย) and does other jobs during a shift.
 * That time is logged as SorterActivity (the ไปชั่งงานขาย / ไปทำงานอื่น buttons) so it
 * is taken out of the sorting time instead of making the sorter look slow. An activity
 * left open past the end of its shift is closed by the system at the shift end.
 *
 * Rows from the earlier timed-round flow (start/stop) are read as records like any other.
 * Nothing opens a round any more; one still open is closed by closeStaleSorterSessions.
 *
 * A recorded result entered in error is voided (supervisor), never deleted, so its
 * production adjustment is reversed with an audit trail.
 *
 * The whole feature is switched on from a start time (SORTING_ROUNDS_START, set by a
 * supervisor on the report tab). Until then the sorting page and recordSortingResult
 * work exactly as they always have, and the activity actions refuse.
 *
 * Before go-live an admin gets it anyway, as a test mode, on test jobs only (registered
 * with the remark งานทดสอบ, or already carrying test rows). Test rows are flagged 'test'
 * and post nothing to ProductionLog; voiding one leaves ProductionLog alone too.
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
// Per-product pieces-per-hour targets, JSON { productCode: n }. A product with no entry
// falls back to SORTING_TARGET_PROPERTY (the default target).
var SORTING_TARGETS_BY_PRODUCT_PROPERTY = 'SORTING_TARGETS_BY_PRODUCT';
var SORTING_ROUNDS_START_PROPERTY = 'SORTING_ROUNDS_START';
var SORTING_ROUNDS_OFF_MESSAGE = 'ระบบรายงาน KPI คัดแยกยังไม่เปิดใช้งาน';

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

var SORTING_TEST_JOB_REMARK = 'งานทดสอบ';

/**
 * A job set up for trying the round flow: registered with the remark งานทดสอบ, or one
 * that already has test rounds (a result's remark can replace the job's remark later).
 */
function isTestJob(job) {
  if (!job) return false;
  if (String(job.Remark || '').indexOf(SORTING_TEST_JOB_REMARK) !== -1) return true;
  ensureSortingRoundSheets();
  return findRows('SortingRounds', function(r) {
    return String(r.JobID) === String(job.JobID) && isTestRound(r);
  }).length > 0;
}

/** getSortingRoundsMode, narrowed to one job: test mode applies to test jobs only. */
function getSortingRoundsModeForJob(user, job) {
  var mode = getSortingRoundsMode(user);
  return mode === 'test' && !isTestJob(job) ? 'off' : mode;
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
    return { success: true, startAt: '', enabled: false, message: 'ปิดระบบรายงาน KPI คัดแยกแล้ว — กลับไปใช้แบบเดิม' };
  }
  var start = parseBangkokStamp(raw.replace('T', ' '));
  if (!start) return { success: false, message: 'วันเวลาไม่ถูกต้อง' };
  var stamp = formatDate(start);
  props.setProperty(SORTING_ROUNDS_START_PROPERTY, stamp);
  var enabled = isSortingRoundsEnabled();
  return {
    success: true, startAt: stamp, enabled: enabled,
    message: enabled ? 'เปิดระบบรายงาน KPI คัดแยกแล้ว' : 'ตั้งเวลาเปิดระบบรายงาน KPI คัดแยก: ' + stamp.substring(0, 16)
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

/** When the shift a work date / Day-Night pair names begins: 08:00 or 20:00. */
function getShiftStartFor(workDate, shiftDN) {
  var dayStart = parseBangkokStamp(String(workDate) + ' 00:00:00');
  if (!dayStart) return null;
  var hours = String(shiftDN) === 'Night' ? 20 : 8;
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

  // Rounds are no longer opened (results are recorded without a timer); any still open
  // is left from the timer flow and is closed now, or at its shift end if that came first.
  findRows('SortingRounds', function(r) { return String(r.Status) === 'open'; }).forEach(function(r) {
    var end = getShiftEndFor(r.WorkDate, r.ShiftDN);
    if (!end || end.getTime() > now.getTime()) end = now;
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
             openRound: null, openActivity: null, openByJob: {}, needFill: [],
             canCloseJobs: canCloseSortingJobs(user) };
  }

  ensureSortingRoundSheets();
  closeStaleSorterSessions(now);

  var rounds = getAllRows('SortingRounds');
  var openRound = null;
  var openByJob = {};
  var needFill = [];
  var testJobIds = {};
  rounds.forEach(function(r) {
    if (isTestRound(r)) testJobIds[r.JobID] = true;
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
    testJobIds: testJobIds,
    needFill: needFill,
    canCloseJobs: canCloseSortingJobs(user)
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
  if (mode === 'test' && !isTestJob(job)) {
    return { success: false, message: 'โหมดทดสอบ: เริ่มคัดได้เฉพาะงานที่ลงทะเบียนหมายเหตุ "' + SORTING_TEST_JOB_REMARK + '"' };
  }

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

function getSortingTargetsByProduct() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(SORTING_TARGETS_BY_PRODUCT_PROPERTY);
    var parsed = raw ? JSON.parse(raw) : {};
    var out = {};
    Object.keys(parsed || {}).forEach(function(code) {
      var n = Number(parsed[code]);
      if (n > 0) out[code] = Math.round(n);
    });
    return out;
  } catch (e) {
    return {};
  }
}

/** The pieces-per-hour target a round of this product is measured against (0 = none). */
function sortingTargetFor(productCode, targets) {
  var own = targets.byProduct[String(productCode || '')];
  return own > 0 ? own : targets.defaultTarget;
}

function getSortingTargets(token) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  return { success: true, defaultTarget: getSortingTarget(), byProduct: getSortingTargetsByProduct(), breaks: getSortingBreaks() };
}

/**
 * Save the default target and the per-product ones in one go. Supervisor only.
 * data: { defaultTarget: n, byProduct: { productCode: n } } — 0 or blank clears one.
 */
function setSortingTargets(token, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!isSupervisorUser(user)) return { success: false, message: 'เฉพาะหัวหน้างานเท่านั้น' };
  data = data || {};
  var def = Number(data.defaultTarget) || 0;
  if (def < 0) return { success: false, message: 'เป้าหมายไม่ถูกต้อง' };
  var byProduct = {};
  var input = data.byProduct || {};
  var bad = Object.keys(input).filter(function(code) {
    var n = Number(input[code]);
    if (isNaN(n) || n < 0) return true;
    if (n > 0) byProduct[code] = Math.round(n);
    return false;
  });
  if (bad.length) return { success: false, message: 'เป้าหมายไม่ถูกต้อง: ' + bad.join(', ') };

  var props = PropertiesService.getScriptProperties();
  if (def > 0) props.setProperty(SORTING_TARGET_PROPERTY, String(Math.round(def)));
  else props.deleteProperty(SORTING_TARGET_PROPERTY);
  if (Object.keys(byProduct).length) props.setProperty(SORTING_TARGETS_BY_PRODUCT_PROPERTY, JSON.stringify(byProduct));
  else props.deleteProperty(SORTING_TARGETS_BY_PRODUCT_PROPERTY);
  return { success: true, defaultTarget: def > 0 ? Math.round(def) : 0, byProduct: byProduct, message: 'บันทึกเป้าหมายแล้ว' };
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

// Break times per shift, as 'HH:mm-HH:mm' lists (Bangkok). Break minutes are taken out of
// the time the sorter had for sorting. Supervisors change them on the report tab.
var SORTING_BREAKS_PROPERTY = 'SORTING_BREAKS';
var SORTING_DEFAULT_BREAKS = { Day: '12:00-13:00, 17:00-17:30', Night: '00:00-01:00, 05:00-05:30' };

/** '12:00-13:00, 17:00-17:30' → [[720, 780], [1020, 1050]] (minutes of the day), or null if malformed. */
function parseSortingBreakList(text) {
  var out = [];
  var parts = String(text || '').split(',');
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (!part) continue;
    var m = part.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    var a = Number(m[1]) * 60 + Number(m[2]);
    var b = Number(m[3]) * 60 + Number(m[4]);
    if (Number(m[1]) > 23 || Number(m[3]) > 24 || Number(m[2]) > 59 || Number(m[4]) > 59 || a === b) return null;
    out.push([a, b]);
  }
  return out;
}

function getSortingBreaks() {
  var out = { Day: SORTING_DEFAULT_BREAKS.Day, Night: SORTING_DEFAULT_BREAKS.Night };
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(SORTING_BREAKS_PROPERTY);
    var saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === 'object') {
      ['Day', 'Night'].forEach(function(dn) {
        if (typeof saved[dn] === 'string' && parseSortingBreakList(saved[dn])) out[dn] = saved[dn];
      });
    }
  } catch (e) {}
  return out;
}

/** Save the break times. Supervisor only. data: { Day: '12:00-13:00, ...', Night: '...' }. */
function setSortingBreaks(token, data) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!isSupervisorUser(user)) return { success: false, message: 'เฉพาะหัวหน้างานเท่านั้น' };
  data = data || {};
  var out = {};
  var bad = ['Day', 'Night'].filter(function(dn) {
    var text = String(data[dn] || '').trim();
    if (!parseSortingBreakList(text)) return true;
    out[dn] = text;
    return false;
  });
  if (bad.length) return { success: false, message: 'รูปแบบเวลาพักไม่ถูกต้อง (' + bad.join(', ') + ') — ใช้แบบ 12:00-13:00, 17:00-17:30' };
  PropertiesService.getScriptProperties().setProperty(SORTING_BREAKS_PROPERTY, JSON.stringify(out));
  return { success: true, breaks: out, message: 'บันทึกเวลาพักแล้ว' };
}

function inSortingBreak(minuteOfDay, ranges) {
  for (var i = 0; i < ranges.length; i++) {
    var a = ranges[i][0], b = ranges[i][1];
    if (a < b ? (minuteOfDay >= a && minuteOfDay < b) : (minuteOfDay >= a || minuteOfDay < b)) return true;
  }
  return false;
}

/**
 * Where one shift's minutes went, minute by minute up to now (for a shift in progress):
 * a break, away (weighing sales orders / other work), idle (no job was waiting or being
 * sorted), or available for sorting. Each minute counts once, in that order.
 * A job is waiting from its registration until it was completed (or until now).
 */
function sortingShiftTimeline(date, shiftDN, now, breakRanges, activities, jobs) {
  var res = { shiftDN: shiftDN, start: '', end: '', windowMinutes: 0, breakMinutes: 0, weighMinutes: 0,
              otherMinutes: 0, awayMinutes: 0, idleMinutes: 0, availableMinutes: 0 };
  var start = getShiftStartFor(date, shiftDN);
  var end = getShiftEndFor(date, shiftDN);
  if (!start || !end) return res;
  var effEnd = end.getTime() < now.getTime() ? end : now;
  res.start = formatDate(start);
  res.end = formatDate(effEnd);
  var total = Math.max(0, Math.floor((effEnd.getTime() - start.getTime()) / 60000));
  res.windowMinutes = total;
  if (!total) return res;

  var toIdx = function(d) {
    return Math.max(0, Math.min(total, Math.floor((d.getTime() - start.getTime()) / 60000)));
  };
  var mark = function(diff, from, to) {
    if (!from) return;
    var a = toIdx(from), b = toIdx(to || effEnd);
    if (b <= a) return;
    diff[a]++;
    diff[b]--;
  };
  var weigh = new Array(total + 1).fill(0);
  var other = new Array(total + 1).fill(0);
  var avail = new Array(total + 1).fill(0);
  activities.forEach(function(a) {
    var from = parseBangkokStamp(a.StartAt);
    var to = a.EndAt ? parseBangkokStamp(a.EndAt) : now;
    mark(a.Type === SORTER_ACTIVITY_TYPES.weigh ? weigh : other, from, to);
  });
  jobs.forEach(function(j) {
    var from = parseBangkokStamp(j.Timestamp);
    var to = j.CompletedAt ? parseBangkokStamp(j.CompletedAt) : null;
    if (String(j.Status) === 'completed' && !to) return;
    mark(avail, from, to);
  });

  var startMinute = String(shiftDN) === 'Night' ? 20 * 60 : 8 * 60;
  var w = 0, o = 0, v = 0;
  for (var i = 0; i < total; i++) {
    w += weigh[i]; o += other[i]; v += avail[i];
    if (inSortingBreak((startMinute + i) % 1440, breakRanges)) res.breakMinutes++;
    else if (w > 0) res.weighMinutes++;
    else if (o > 0) res.otherMinutes++;
    else if (v <= 0) res.idleMinutes++;
    else res.availableMinutes++;
  }
  res.awayMinutes = res.weighMinutes + res.otherMinutes;
  return res;
}

/**
 * Daily sorter report for one work date and (optionally) one crew A/B and Day/Night.
 * filters: { date: 'yyyy-MM-dd', shift: 'A'|'B'|'', shiftDN: 'Day'|'Night'|'' }
 *
 * No timer: the sorter records results as before, and each recorded result is a row in
 * SortingRounds. The time behind the pieces is the shift itself:
 *   available = shift time so far − breaks − weighing / other work − idle (no job waiting)
 *   pieces per hour = pieces recorded ÷ available hours
 *   % of target = earned hours ÷ available hours, where each record earns its pieces ÷
 *     its own product's target, so a slower product does not read as slow sorting.
 * One sorter works a shift, so the shift's time is theirs; with more than one name in
 * scope the rates are for the crew and each person shows their pieces.
 *
 * Timeliness: wait = registration (or the start of the shift, if registered earlier)
 * to the job being pulled for sorting, for jobs pulled in the shift; close rate = jobs a
 * result finished ÷ jobs results were recorded on.
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

  var records = findRows('SortingRounds', function(r) { return String(r.Status) === 'closed' && inScope(r); });
  var activities = findRows('SorterActivity', inScope);
  var allJobs = getAllRows('SortingLog');
  records.sort(function(a, b) { return String(a.Timestamp).localeCompare(String(b.Timestamp)); });
  activities.sort(function(a, b) { return String(a.StartAt).localeCompare(String(b.StartAt)); });

  // The shifts the time is counted over: the one asked for, or — for one crew over the
  // whole day — the shifts that crew has anything recorded in.
  var dns = shiftDN ? [shiftDN] : ['Day', 'Night'];
  if (shift && !shiftDN) {
    var seen = {};
    records.concat(activities).forEach(function(r) { seen[String(r.ShiftDN)] = true; });
    dns = dns.filter(function(dn) { return seen[dn]; });
  }
  var breaks = getSortingBreaks();
  var time = { windowMinutes: 0, breakMinutes: 0, weighMinutes: 0, otherMinutes: 0, awayMinutes: 0,
               idleMinutes: 0, availableMinutes: 0, windows: [] };
  dns.forEach(function(dn) {
    var t = sortingShiftTimeline(date, dn, now, parseSortingBreakList(breaks[dn]) || [],
      activities.filter(function(a) { return String(a.ShiftDN) === dn; }), allJobs);
    time.windows.push(t);
    ['windowMinutes', 'breakMinutes', 'weighMinutes', 'otherMinutes', 'awayMinutes', 'idleMinutes', 'availableMinutes']
      .forEach(function(k) { time[k] += t[k]; });
  });

  var targets = { defaultTarget: getSortingTarget(), byProduct: getSortingTargetsByProduct() };
  var people = {};
  var person = function(id, name) {
    if (!people[id]) {
      people[id] = { employeeId: id, employeeName: name || id, records: 0, good: 0, lug: 0, screw: 0, screwLug: 0,
                     pieces: 0, earnedMinutes: 0, untargetedPieces: 0, weighMinutes: 0, otherMinutes: 0,
                     jobsCompleted: 0, jobsWorked: 0, workedJobIds: {} };
    }
    return people[id];
  };
  var tot = { records: 0, good: 0, lug: 0, screw: 0, screwLug: 0, pieces: 0, earnedMinutes: 0, untargetedPieces: 0 };
  var workedJobs = {}, doneJobs = {};
  records.forEach(function(r) {
    var p = person(r.EmployeeID, r.EmployeeName);
    var q = { good: Number(r.GoodQty) || 0, lug: Number(r.DefectLug) || 0, screw: Number(r.DefectScrew) || 0, screwLug: Number(r.DefectScrewLug) || 0 };
    var pieces = q.good + q.lug + q.screw + q.screwLug;
    var tgt = sortingTargetFor(r.ProductCode, targets);
    var earned = tgt > 0 ? pieces / tgt * 60 : 0;
    r.pieces = pieces;
    r.target = tgt;
    [p, tot].forEach(function(acc) {
      acc.records++;
      acc.good += q.good; acc.lug += q.lug; acc.screw += q.screw; acc.screwLug += q.screwLug;
      acc.pieces += pieces;
      acc.earnedMinutes += earned;
      if (!(tgt > 0)) acc.untargetedPieces += pieces;
    });
    if (!p.workedJobIds[r.JobID]) { p.workedJobIds[r.JobID] = true; p.jobsWorked++; }
    workedJobs[r.JobID] = true;
    if (String(r.StopReason) === 'done') { p.jobsCompleted++; doneJobs[r.JobID] = true; }
  });
  activities.forEach(function(a) {
    var p = person(a.EmployeeID, a.EmployeeName);
    var minutes = a.EndAt ? (Number(a.Minutes) || 0) : minutesBetween(parseBangkokStamp(a.StartAt), now);
    a.liveMinutes = minutes;
    if (a.Type === SORTER_ACTIVITY_TYPES.weigh) p.weighMinutes += minutes;
    else p.otherMinutes += minutes;
  });

  var rate = function(acc, minutes) {
    acc.pcsPerHour = minutes > 0 ? Math.round(acc.pieces / minutes * 60) : null;
    acc.targetPct = minutes > 0 && acc.earnedMinutes > 0 ? Math.round(acc.earnedMinutes / minutes * 100) : null;
    var r = partNgRates(acc.good, acc.lug + acc.screwLug, acc.screw + acc.screwLug);
    acc.ngRate = acc.pieces > 0 ? Number(r.rate).toFixed(2) : '0.00';
  };
  rate(tot, time.availableMinutes);
  tot.earnedMinutes = Math.round(tot.earnedMinutes);
  var summary = Object.keys(people).map(function(id) {
    var p = people[id];
    delete p.workedJobIds;
    p.closeRate = p.jobsWorked > 0 ? Math.round(p.jobsCompleted / p.jobsWorked * 100) : null;
    p.earnedMinutes = Math.round(p.earnedMinutes);
    return p;
  });
  summary.sort(function(a, b) { return String(a.employeeName).localeCompare(String(b.employeeName)); });
  // The shift's time belongs to its sorter when there is just one.
  if (summary.length === 1) rate(summary[0], time.availableMinutes);

  // Wait before sorting: jobs pulled during these shifts.
  var waits = [];
  time.windows.forEach(function(t) {
    var ws = parseBangkokStamp(t.start), we = parseBangkokStamp(t.end);
    if (!ws || !we) return;
    allJobs.forEach(function(j) {
      var pulled = parseBangkokStamp(j.PulledAt);
      var reg = parseBangkokStamp(j.Timestamp);
      if (!pulled || !reg || pulled.getTime() < ws.getTime() || pulled.getTime() > we.getTime()) return;
      waits.push(minutesBetween(reg.getTime() > ws.getTime() ? reg : ws, pulled));
    });
  });
  tot.waitCount = waits.length;
  tot.avgWaitMinutes = waits.length ? Math.round(waits.reduce(function(a, b) { return a + b; }, 0) / waits.length) : null;
  tot.maxWaitMinutes = waits.length ? Math.max.apply(null, waits) : null;
  tot.jobsWorked = Object.keys(workedJobs).length;
  tot.jobsCompleted = Object.keys(doneJobs).length;
  tot.closeRate = tot.jobsWorked > 0 ? Math.round(tot.jobsCompleted / tot.jobsWorked * 100) : null;

  // Jobs worked in these shifts plus everything still waiting, as of now.
  var jobs = allJobs.filter(function(j) {
    var st = String(j.Status || '');
    return workedJobs[j.JobID] || ((st === 'pending' || st === 'in-progress') && String(j.Date) <= date);
  }).map(function(j) {
    var sorted = (Number(j.GoodQty) || 0) + (Number(j.DefectQty) || 0);
    var total = Number(j.TotalQty) || 0;
    return {
      jobId: j.JobID, date: j.Date, machineId: j.MachineID, productCode: j.ProductCode,
      foundProcess: j.FoundProcess, status: j.Status, totalQty: total, sorted: sorted,
      remaining: Math.max(0, total - sorted), workedThisShift: !!workedJobs[j.JobID],
      shortClosed: !!j.ShortClosedAt, shortCloseReason: j.ShortCloseReason || ''
    };
  });
  jobs.sort(function(a, b) { return String(a.jobId).localeCompare(String(b.jobId)); });
  var open = jobs.filter(function(j) { return j.status !== 'completed'; });
  var carried = open.filter(function(j) { return j.workedThisShift; });
  tot.carriedJobs = carried.length;
  tot.carriedPieces = carried.reduce(function(a, j) { return a + j.remaining; }, 0);
  tot.backlogJobs = open.length;
  tot.backlogPieces = open.reduce(function(a, j) { return a + j.remaining; }, 0);

  return {
    success: true,
    generatedAt: formatDate(now),
    filters: { date: date, shift: shift, shiftDN: shiftDN },
    target: targets.defaultTarget,
    targetsByProduct: targets.byProduct,
    breaks: breaks,
    time: time,
    totals: tot,
    summary: summary,
    records: records,
    activities: activities,
    jobs: jobs
  };
}
