// The date format of the user the classic engine is serving now (set per request from the user's settings): screens,
// selection screens, ALV, WRITE lists, string templates with DATE = USER, printed forms and the function module test page.
import { DATE_FORMATS, formatDate, parseUserDate } from '../server/usersettings.js';

let code = '1';
export const userDate = {
  get code() { return code; },
  set code(c) { code = c != null && Object.hasOwn(DATE_FORMATS, String(c)) ? String(c) : '1'; },
  get pattern() { return DATE_FORMATS[code]; },
  format: internal => formatDate(internal, code),
  parse: text => parseUserDate(text, code),
};
