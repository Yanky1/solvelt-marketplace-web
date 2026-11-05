/**
 * Is this URL path part of the staff area? `/staff`, `/staff/...` and their single-fetch data requests (`/staff.data`, `/staff/buyers.data`), and nothing that merely starts with the same
 * letters (a future `/staff-picks`). server.js carries the same expression (it is plain JavaScript and cannot import this file): keep them equal (the test reads both).
 */
export const STAFF_PATH = /^\/staff(?:\.data)?(?:\/|$)/;
export const isStaffPath = (pathname: string): boolean => STAFF_PATH.test(pathname);
