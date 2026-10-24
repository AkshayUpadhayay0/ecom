import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  assertSafeKey,
  type Bucket,
  type ObjectHead,
  type StorageProvider,
} from './storage-provider.js';

/** Route prefix (under /api/v1) served by local-media.routes.ts. */
export const LOCAL_MEDIA_PATH = '/media-local';
const MS_PER_SECOND = 1000;
const SECRET_BYTES = 32;
const META_SUFFIX = '.meta.json';

/** Signed claim carried in local upload/download URLs (the local stand-in for S3 presigning). */
export interface LocalToken {
  op: 'put' | 'get';
  bucket: Bucket;
  key: string;
  /** Expiry, epoch ms. */
  exp: number;
  /** put only: exact type and size the upload must have. */
  contentType?: string;
  contentLength?: number;
}

export class LocalUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'LocalUploadError';
  }
}

export interface LocatedObject {
  path: string;
  /** Bucket folder: the only place files may be served from. */
  root: string;
  /** Key relative to 
oot (forward slashes). */
  relative: string;
  contentType: string;
}

export interface LocalStorage extends StorageProvider {
  readonly driver: 'local';
  verifyToken(token: string): LocalToken | undefined;
  /** Streams a PUT body to disk, enforcing the token's type and exact length. */
  receiveUpload(token: LocalToken, contentType: string | undefined, body: Readable): Promise<void>;
  /**
   * Where an object lives: the bucket folder (
oot), the key relative to it, the absolute path and the
   * content type; undefined when the file does not exist.
   */
  locate(bucket: Bucket, key: string): Promise<LocatedObject | undefined>;
}

export interface LocalStorageConfig {
  rootDir: string;
  /** Public base URL of this API (e.g. http://localhost:4000). */
  apiPublicUrl: string;
  /** HMAC key for URL tokens; random per process when absent. */
  secret?: string | undefined;
  /** Mount path of the API (e.g. /api/v1). */
  basePath: string;
}

/**
 * MOCK storage for dev/test (no keys): objects are files under rootDir/<bucket>/<key>, and the
 * API serves signed upload/download routes that imitate presigned URLs. Never used in
 * production (env validation requires R2 there).
 */
export function createLocalStorage(config: LocalStorageConfig): LocalStorage {
  const root = resolve(config.rootDir);
  const secret = config.secret ?? randomBytes(SECRET_BYTES).toString('hex');
  const baseUrl = `${config.apiPublicUrl.replace(/\/+$/, '')}${config.basePath}${LOCAL_MEDIA_PATH}`;

  function pathOf(bucket: Bucket, key: string): string {
    assertSafeKey(key);
    const full = resolve(root, bucket, ...key.split('/'));
    if (!full.startsWith(`${resolve(root, bucket)}${sep}`)) {
      throw new Error(`Refusing key outside the bucket: ${key}`);
    }
    return full;
  }

  function sign(payload: string): string {
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  function issue(token: LocalToken): string {
    const payload = Buffer.from(JSON.stringify(token)).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }

  async function writeMeta(path: string, contentType: string): Promise<void> {
    await writeFile(`${path}${META_SUFFIX}`, JSON.stringify({ contentType }));
  }

  async function readMeta(path: string): Promise<string | undefined> {
    try {
      const meta = JSON.parse(await readFile(`${path}${META_SUFFIX}`, 'utf8')) as {
        contentType?: string;
      };
      return meta.contentType;
    } catch {
      return undefined;
    }
  }

  return {
    driver: 'local',

    createPresignedUpload(input) {
      pathOf(input.bucket, input.key);
      const exp = Date.now() + input.expiresInSeconds * MS_PER_SECOND;
      const token = issue({
        op: 'put',
        bucket: input.bucket,
        key: input.key,
        exp,
        contentType: input.contentType,
        contentLength: input.contentLength,
      });
      return Promise.resolve({
        url: `${baseUrl}/upload/${token}`,
        method: 'PUT' as const,
        headers: { 'Content-Type': input.contentType },
        expiresAt: new Date(exp),
      });
    },

    verifyToken(token) {
      const [payload, signature] = token.split('.');
      if (!payload || !signature) return undefined;
      const expected = Buffer.from(sign(payload));
      const given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
      try {
        const claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LocalToken;
        return claim.exp > Date.now() ? claim : undefined;
      } catch {
        return undefined;
      }
    },

    async receiveUpload(token, contentType, body) {
      if (token.op !== 'put' || token.contentLength === undefined) {
        throw new LocalUploadError('Invalid upload token.', 403);
      }
      if (contentType?.split(';')[0]?.trim().toLowerCase() !== token.contentType) {
        throw new LocalUploadError('Content-Type does not match the signed upload.', 403);
      }
      const path = pathOf(token.bucket, token.key);
      await mkdir(dirname(path), { recursive: true });
      const partial = `${path}.part`;
      let received = 0;
      const limit = token.contentLength;
      body.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > limit)
          body.destroy(new LocalUploadError('Body larger than signed size.', 403));
      });
      try {
        await pipeline(body, createWriteStream(partial));
        if (received !== limit)
          throw new LocalUploadError('Body size does not match the signed size.', 403);
        await rename(partial, path);
        await writeMeta(path, token.contentType ?? 'application/octet-stream');
      } finally {
        await rm(partial, { force: true });
      }
    },

    async locate(bucket, key) {
      const path = pathOf(bucket, key);
      try {
        if (!(await stat(path)).isFile()) return undefined; // a folder is not an object
      } catch {
        return undefined;
      }
      return {
        path,
        root: join(root, bucket),
        relative: key,
        contentType: (await readMeta(path)) ?? 'application/octet-stream',
      };
    },

    async headObject(bucket, key): Promise<ObjectHead | undefined> {
      const path = pathOf(bucket, key);
      try {
        const info = await stat(path);
        return { contentLength: info.size, contentType: await readMeta(path) };
      } catch {
        return undefined;
      }
    },

    async readRange(bucket, key, length) {
      const handle = await open(pathOf(bucket, key), 'r');
      try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, 0);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },

    async downloadToFile(bucket, key, filePath) {
      await pipeline(createReadStream(pathOf(bucket, key)), createWriteStream(filePath));
    },

    async uploadFile(bucket, key, filePath, contentType) {
      const path = pathOf(bucket, key);
      await mkdir(dirname(path), { recursive: true });
      await copyFile(filePath, path);
      await writeMeta(path, contentType);
    },

    getPublicUrl(key) {
      assertSafeKey(key);
      return `${baseUrl}/public/${key}`;
    },

    createPrivateSignedUrl(key, expiresInSeconds) {
      pathOf('private', key);
      const token = issue({
        op: 'get',
        bucket: 'private',
        key,
        exp: Date.now() + expiresInSeconds * MS_PER_SECOND,
      });
      return Promise.resolve(`${baseUrl}/private/${token}`);
    },

    async delete(bucket, key) {
      const path = pathOf(bucket, key);
      await rm(path, { force: true });
      await rm(`${path}${META_SUFFIX}`, { force: true });
    },
  };
}

/** Test helper: absolute root of a bucket (used to assert files on disk). */
export function localBucketDir(rootDir: string, bucket: Bucket): string {
  return join(resolve(rootDir), bucket);
}
