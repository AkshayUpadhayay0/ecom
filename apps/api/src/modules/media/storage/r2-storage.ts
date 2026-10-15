import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  assertSafeKey,
  type Bucket,
  type ObjectHead,
  type StorageProvider,
} from './storage-provider.js';

const HTTP_NOT_FOUND = 404;
const MS_PER_SECOND = 1000;

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBucket: string;
  privateBucket: string;
  /** CDN / public domain of the public bucket. */
  publicBaseUrl: string;
}

function isNotFound(err: unknown): boolean {
  return err instanceof S3ServiceException && err.$metadata.httpStatusCode === HTTP_NOT_FOUND;
}

/**
 * Cloudflare R2 through the S3 API. Credentials stay inside the client and are never logged.
 * Presigned uploads sign Content-Type and Content-Length, so R2 rejects any other type or size.
 */
export function createR2Storage(config: R2Config): StorageProvider {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const bucketName = (bucket: Bucket): string =>
    bucket === 'public' ? config.publicBucket : config.privateBucket;
  const publicBase = config.publicBaseUrl.replace(/\/+$/, '');

  async function bodyOf(bucket: Bucket, key: string, range?: string) {
    assertSafeKey(key);
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucketName(bucket), Key: key, Range: range }),
    );
    if (!result.Body) throw new Error(`Empty body for ${key}`);
    return result.Body;
  }

  return {
    driver: 'r2',

    async createPresignedUpload(input) {
      assertSafeKey(input.key);
      const command = new PutObjectCommand({
        Bucket: bucketName(input.bucket),
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
      });
      const url = await getSignedUrl(client, command, {
        expiresIn: input.expiresInSeconds,
        signableHeaders: new Set(['content-type', 'content-length']),
      });
      return {
        url,
        method: 'PUT',
        // Browsers set Content-Length themselves from the body; it is still signed.
        headers: { 'Content-Type': input.contentType },
        expiresAt: new Date(Date.now() + input.expiresInSeconds * MS_PER_SECOND),
      };
    },

    async headObject(bucket, key): Promise<ObjectHead | undefined> {
      assertSafeKey(key);
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: bucketName(bucket), Key: key }),
        );
        return { contentLength: head.ContentLength ?? 0, contentType: head.ContentType };
      } catch (err) {
        if (isNotFound(err)) return undefined;
        throw err;
      }
    },

    async readRange(bucket, key, length) {
      const body = await bodyOf(bucket, key, `bytes=0-${length - 1}`);
      return Buffer.from(await body.transformToByteArray());
    },

    async downloadToFile(bucket, key, filePath) {
      const body = await bodyOf(bucket, key);
      if (!(body instanceof Readable)) throw new Error('Expected a Node stream from R2');
      await pipeline(body, createWriteStream(filePath));
    },

    async uploadFile(bucket, key, filePath, contentType) {
      assertSafeKey(key);
      const { size } = await stat(filePath);
      await client.send(
        new PutObjectCommand({
          Bucket: bucketName(bucket),
          Key: key,
          Body: createReadStream(filePath),
          ContentLength: size,
          ContentType: contentType,
        }),
      );
    },

    getPublicUrl(key) {
      assertSafeKey(key);
      return `${publicBase}/${key}`;
    },

    async createPrivateSignedUrl(key, expiresInSeconds) {
      assertSafeKey(key);
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: config.privateBucket, Key: key }),
        { expiresIn: expiresInSeconds },
      );
    },

    async delete(bucket, key) {
      assertSafeKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: bucketName(bucket), Key: key }));
    },
  };
}
