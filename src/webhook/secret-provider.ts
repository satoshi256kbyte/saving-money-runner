import { GetSecretValueCommand, type SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import type { Clock, SecretSource } from './types';

// Lambda の実行環境内のメモリに保持する時間（clarify.md Q-008、AWS Parameters and Secrets Lambda Extension の上限）。
export const SECRET_CACHE_TTL_MS = 300_000;

// 取得に失敗したことだけを表す。SDKのエラーは内容を持ち越さない（値や ARN を例外に出さないため）。
export class SecretUnavailableError extends Error {
  constructor() {
    super('secret_unavailable');
    this.name = 'SecretUnavailableError';
  }
}

export interface SecretProviderOptions {
  client: Pick<SecretsManagerClient, 'send'>;
  secretId: string;
  clock: Clock;
  cacheTtlMs?: number;
}

// AWSCURRENT と、存在すれば AWSPENDING の値を返す。ローテーション中の2版の検証に使う（clarify.md Q-006）。
// キャッシュの期間内は再取得しない。不一致を理由に再取得することも、ここではしない。
// 注意: キャッシュの期限切れ後に取得が失敗したら、古い値は使わず例外にする（503 にするため）。
export function createSecretProvider(options: SecretProviderOptions): SecretSource {
  const ttlMs = options.cacheTtlMs ?? SECRET_CACHE_TTL_MS;
  let cached: { values: readonly string[]; fetchedAtMs: number } | undefined;

  return {
    async getSigningSecrets() {
      const nowMs = options.clock.nowMs();
      if (cached !== undefined && nowMs - cached.fetchedAtMs <= ttlMs) {
        return cached.values;
      }

      // AWSCURRENT の失敗（不在を含む）は、署名検証に使えないため例外にする（503）。
      const current = await readRequiredStage(options, 'AWSCURRENT');
      // AWSPENDING が無いことは平常の状態（ローテーション中でない）として扱う。それ以外の失敗は、
      // 2版の検証を保証できないため失敗にする。
      const pending = await readOptionalStage(options, 'AWSPENDING');
      const values = pending === undefined ? [current] : [current, pending];

      cached = { values, fetchedAtMs: nowMs };
      return values;
    },
  };
}

async function readRequiredStage(options: SecretProviderOptions, stage: string): Promise<string> {
  const value = await fetchStageString(options, stage);
  if (value === undefined) {
    throw new SecretUnavailableError();
  }
  return value;
}

// 版が存在しないことだけを undefined で返す。それ以外の失敗は例外にする。
async function readOptionalStage(
  options: SecretProviderOptions,
  stage: string,
): Promise<string | undefined> {
  return fetchStageString(options, stage, { allowMissing: true });
}

interface FetchOptions {
  allowMissing?: boolean;
}

// SDKのエラーは分類だけ残して捨てる。値や ARN を例外や呼び出し元へ持ち越さないため。
async function fetchStageString(
  options: SecretProviderOptions,
  stage: string,
  fetch: FetchOptions = {},
): Promise<string | undefined> {
  try {
    const output = await options.client.send(
      new GetSecretValueCommand({ SecretId: options.secretId, VersionStage: stage }),
    );
    if (typeof output.SecretString !== 'string' || output.SecretString === '') {
      throw new SecretUnavailableError();
    }
    return output.SecretString;
  } catch (error) {
    if (fetch.allowMissing && isNamed(error, 'ResourceNotFoundException')) {
      return undefined;
    }
    throw new SecretUnavailableError();
  }
}

function isNamed(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === name;
}
