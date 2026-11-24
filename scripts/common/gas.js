"use strict";
async function callGas(url, token, action, extra = {}) {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== "script.google.com" || !u.pathname.endsWith("/exec")) throw new Error("Invalid GAS URL");
  if (!token) throw new Error("Missing GAS token");
  const response = await fetch(u, {
    method: "POST", redirect: "follow",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({...extra, action, token}),
    signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) throw new Error("GAS HTTP " + response.status);
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || "GAS rejected request");
  return result;
}
module.exports = { callGas };
