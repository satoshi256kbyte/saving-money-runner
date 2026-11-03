import type { HandoffMessage } from './types';

export type JsonResult =
  | { ok: true; value: unknown }
  | { ok: false; classification: 'payload_invalid' };

// 不正なUTF-8を黙って置き換えず、JSONとして解釈できない入力を拒否する。
export function parseJsonBody(bytes: Uint8Array): JsonResult {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, classification: 'payload_invalid' };
  }
}

export type ExtractResult =
  | { ok: true; message: HandoffMessage }
  | { ok: false; classification: 'payload_invalid' };

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

// workflow_job の許可リストの項目だけを取り出す。bodyをそのまま後続へ渡さない（plan.md の後続メッセージの契約）。
// installation と organization は任意項目（GitHubのスキーマ上）。無い場合は null にする。
// 型が合わない値があれば payload_invalid にする。
export function extractWorkflowJobMessage(
  payload: unknown,
  deliveryId: string,
  receivedAt: string,
): ExtractResult {
  if (!isDict(payload)) {
    return invalid();
  }
  const { action, workflow_job: job, repository, installation, organization } = payload;

  if (typeof action !== 'string' || action === '') return invalid();
  if (!isDict(job) || !isDict(repository)) return invalid();

  const labels = job.labels;
  if (!isInteger(job.id) || !isInteger(job.run_id) || !Array.isArray(labels)) return invalid();
  if (!labels.every((label) => typeof label === 'string')) return invalid();
  if (typeof job.status !== 'string') return invalid();

  if (!isInteger(repository.id) || typeof repository.full_name !== 'string') return invalid();

  const installationId = optionalId(installation);
  const organizationLogin = optionalLogin(organization);
  if (installationId === undefined || organizationLogin === undefined) return invalid();

  return {
    ok: true,
    message: {
      schemaVersion: 1,
      deliveryId,
      event: 'workflow_job',
      receivedAt,
      action,
      jobId: job.id,
      runId: job.run_id,
      labels: labels as string[],
      status: job.status,
      repositoryId: repository.id,
      repositoryFullName: repository.full_name,
      installationId,
      organizationLogin,
    },
  };
}

// 任意項目。無い（undefined か null）なら null、型が合わなければ undefined（呼び出し側で拒否する）。
function optionalId(installation: unknown): number | null | undefined {
  if (installation === undefined || installation === null) return null;
  if (isDict(installation) && isInteger(installation.id)) return installation.id;
  return undefined;
}

function optionalLogin(organization: unknown): string | null | undefined {
  if (organization === undefined || organization === null) return null;
  if (isDict(organization) && typeof organization.login === 'string') return organization.login;
  return undefined;
}

function invalid(): { ok: false; classification: 'payload_invalid' } {
  return { ok: false, classification: 'payload_invalid' };
}
