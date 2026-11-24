"use strict";
function jstDates(days, now = new Date()) {
  const day = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0,10);
  return Array.from({length:days}, (_,i) => new Date(Date.parse(day+"T00:00:00Z") - i*86400000).toISOString().slice(0,10));
}
module.exports = { jstDates };
