/**
 * Backend configuration values that are not secrets (secrets/IDs live in Script Properties).
 */

var APP_CONFIG = {
  /**
   * Manpower (เข้างาน / OT) for the dashboard PDF report.
   *
   * Data comes from the "Attendance" tab of the JR Organize spreadsheet, but this code
   * never opens that file. It reads a mirror tab in THIS web app's own spreadsheet:
   *
   *   1. In this app's spreadsheet create a tab named exactly as SHEET below (Attendance_JR).
   *   2. In cell A1 of that tab put:
   *        =IMPORTRANGE("1LxRYOtg0LL6_VSuNsaNuNuBUHal_T4eOYgy4tOrHNfE","Attendance!A:J")
   *   3. Click the cell and press "Allow access" once (IMPORTRANGE asks the first time).
   *
   * Row 1 is then the JR Organize header row (WorkDate | Timestamp | Username | Name |
   * Department | Type | CheckedByUsername | CheckedByName | SubDepartment | Position).
   * Columns are found by header name, so their order may change.
   *
   * Do NOT add this tab to initializeSystem()/createSheetIfNotExists or ensureSheetExists:
   * its header row comes from IMPORTRANGE, and writing headers into A1 would break it.
   *
   * SUB_DEPARTMENT: value of the SubDepartment column (column I) to report on; compared
   * ignoring upper/lower case and spaces.
   */
  ATTENDANCE: {
    SHEET: 'Attendance_JR',
    SUB_DEPARTMENT: 'Lug&Screw'
  }
};
