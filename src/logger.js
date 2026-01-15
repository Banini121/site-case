import fs from 'node:fs';
import path from 'node:path';

const logDir = path.resolve('logs');
const prizeDir = path.resolve('data/prizes');
for (const dir of [logDir, prizeDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeLog(dir, file, entry) {
  const line = `${new Date().toISOString()} ${JSON.stringify(entry)}\n`;
  fs.appendFile(path.join(dir, file), line, () => {});
}

export const auditLog = (entry) => writeLog(logDir, 'audit.log', entry);
export const authLog = (entry) => writeLog(logDir, 'auth.log', entry);
export const rateLog = (entry) => writeLog(logDir, 'rate.log', entry);
export const errorLog = (entry) => writeLog(logDir, 'error.log', entry);
export const prizeLog = (entry) => writeLog(prizeDir, 'prizes.log', entry);
