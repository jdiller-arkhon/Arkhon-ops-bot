import type { OpsConfig } from '../config.js';

/**
 * Client for arkhonindustries.com's community verification API (/api/community/v1).
 * Authenticated with a bearer token dedicated to this bot (ARKHON_COMMUNITY_API_TOKEN).
 */
export type VerificationStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface StartedVerification {
  requestId: string;
  confirmUrl: string;
  expiresAt: string;
}

export interface VerificationState {
  status: VerificationStatus;
  memberId: string;
  discordUserId: string;
  accountRole: string | null;
  linkedAt: string | null;
}

export interface WebsiteLink {
  memberId: string;
  accountRole: string | null;
  linkedAt: string;
}

export type ApiErrorCode =
  | 'invalid_member_id'
  | 'member_not_found'
  | 'member_already_linked'
  | 'discord_already_linked'
  | 'rate_limited'
  | 'not_found'
  | 'not_linked'
  | 'unauthorized'
  | 'unavailable';

export class CommunityApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CommunityApiError';
  }
}

const TIMEOUT_MS = 8000;

export class CommunityApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  static fromConfig(config: OpsConfig, fetchImpl?: typeof fetch): CommunityApi | undefined {
    const { websiteUrl, apiToken, enabled } = config.verification;
    return enabled && apiToken ? new CommunityApi(websiteUrl, apiToken, fetchImpl) : undefined;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/community/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new CommunityApiError(
        'unavailable',
        0,
        `website unreachable: ${(error as Error).message}`,
      );
    }
    const data = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
    if (!response.ok) {
      const code = (
        response.status === 401
          ? 'unauthorized'
          : response.status >= 500
            ? 'unavailable'
            : (data.code ?? 'unavailable')
      ) as ApiErrorCode;
      throw new CommunityApiError(code, response.status, data.message ?? `HTTP ${response.status}`);
    }
    return data as T;
  }

  startVerification(input: { memberId: string; discordUserId: string; discordUsername: string }) {
    return this.request<StartedVerification>('POST', '/verifications', input);
  }

  getVerification(requestId: string, discordUserId: string) {
    return this.request<VerificationState>(
      'GET',
      `/verifications/${encodeURIComponent(requestId)}?discordUserId=${encodeURIComponent(discordUserId)}`,
    );
  }

  getLink(discordUserId: string) {
    return this.request<WebsiteLink>('GET', `/links/${encodeURIComponent(discordUserId)}`);
  }

  unlink(discordUserId: string) {
    return this.request<{ unlinked: boolean }>(
      'DELETE',
      `/links/${encodeURIComponent(discordUserId)}`,
    );
  }
}
