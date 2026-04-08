import * as fs from 'fs/promises';
import * as path from 'path';

type JsonValue = Record<string, unknown>;

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeJsonFileAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const serialized = JSON.stringify(value, null, 2);
  await fs.writeFile(tempPath, serialized, 'utf-8');
  await fs.rename(tempPath, filePath);
}

export async function appendJsonlRecords(
  filePath: string,
  records: unknown[],
): Promise<void> {
  if (records.length === 0) {
    return;
  }
  await ensureDir(path.dirname(filePath));
  const handle = await fs.open(filePath, 'a');
  try {
    const payload = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
    await handle.writeFile(payload, 'utf-8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function readJsonlRecords<T extends JsonValue>(
  filePath: string,
): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return parseJsonlRecords<T>(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function readFirstJsonlRecordMatching<T extends JsonValue>(
  filePath: string,
  predicate: (record: T) => boolean,
): Promise<T | null> {
  let handle: fs.FileHandle | null = null;

  try {
    handle = await fs.open(filePath, 'r');
    for await (const rawLine of handle.readLines()) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const record = JSON.parse(line) as T;
      if (predicate(record)) {
        return record;
      }
    }

    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export function parseJsonlRecords<T extends JsonValue>(raw: string): T[] {
  if (!raw.trim()) {
    return [];
  }

  const lines = raw.split('\n');
  const records: T[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    try {
      records.push(JSON.parse(line) as T);
    } catch (error) {
      const isLastNonEmptyLine = isLastMeaningfulLine(lines, index);
      if (isLastNonEmptyLine && !raw.endsWith('\n')) {
        break;
      }
      throw error;
    }
  }

  return records;
}

function isLastMeaningfulLine(lines: string[], index: number): boolean {
  for (let current = index + 1; current < lines.length; current += 1) {
    if (lines[current].trim()) {
      return false;
    }
  }
  return true;
}
