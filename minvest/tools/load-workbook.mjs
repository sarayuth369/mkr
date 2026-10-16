import readXlsxFile, { readSheetNames } from 'read-excel-file/node';
import { PLATFORMS, normalizeSheet } from './normalize.mjs';

/** Reads the owner's Excel and returns normalized sheets (no network, no writes). */
export async function loadWorkbook(path) {
  const names = await readSheetNames(path);
  const missing = Object.keys(PLATFORMS).filter((n) => !names.includes(n));
  if (missing.length) throw new Error(`ไม่พบชีต: ${missing.join(', ')} (พบ: ${names.join(', ')})`);
  const sheets = [];
  for (const name of Object.keys(PLATFORMS)) sheets.push(normalizeSheet(name, await readXlsxFile(path, { sheet: name })));
  return sheets;
}
