import type { Env } from '../../../config/env.js';
import { createLocalStorage, type LocalStorage } from './local-storage.js';
import { createR2Storage } from './r2-storage.js';
import type { StorageProvider } from './storage-provider.js';

export type StorageEnv = Pick<
  Env,
  | 'MEDIA_STORAGE_DRIVER'
  | 'MEDIA_LOCAL_DIR'
  | 'MEDIA_LOCAL_SECRET'
  | 'API_PUBLIC_URL'
  | 'R2_ACCOUNT_ID'
  | 'R2_ACCESS_KEY_ID'
  | 'R2_SECRET_ACCESS_KEY'
  | 'R2_PUBLIC_BUCKET'
  | 'R2_PRIVATE_BUCKET'
  | 'R2_PUBLIC_BASE_URL'
>;

function required(value: string | undefined, name: string): string {
  // env validation already guarantees these for the r2 driver; this keeps the types honest.
  if (value === undefined) throw new Error(`${name} is required for MEDIA_STORAGE_DRIVER=r2`);
  return value;
}

/** Picks the storage implementation from MEDIA_STORAGE_DRIVER. */
export function createStorage(env: StorageEnv, basePath: string): StorageProvider {
  if (env.MEDIA_STORAGE_DRIVER === 'local') {
    return createLocalStorage({
      rootDir: env.MEDIA_LOCAL_DIR,
      apiPublicUrl: env.API_PUBLIC_URL,
      secret: env.MEDIA_LOCAL_SECRET,
      basePath,
    });
  }
  return createR2Storage({
    accountId: required(env.R2_ACCOUNT_ID, 'R2_ACCOUNT_ID'),
    accessKeyId: required(env.R2_ACCESS_KEY_ID, 'R2_ACCESS_KEY_ID'),
    secretAccessKey: required(env.R2_SECRET_ACCESS_KEY, 'R2_SECRET_ACCESS_KEY'),
    publicBucket: required(env.R2_PUBLIC_BUCKET, 'R2_PUBLIC_BUCKET'),
    privateBucket: required(env.R2_PRIVATE_BUCKET, 'R2_PRIVATE_BUCKET'),
    publicBaseUrl: required(env.R2_PUBLIC_BASE_URL, 'R2_PUBLIC_BASE_URL'),
  });
}

export function isLocalStorage(storage: StorageProvider): storage is LocalStorage {
  return storage.driver === 'local';
}
