export interface CreatedIssue {
  number: number;
  url: string;
}

export interface CreateIssueInput {
  token: string;
  repo: string; // owner/name
  title: string;
  body: string;
  labels: string[];
}

/** Creates a GitHub issue through the REST API. Throws with GitHub's error message on failure. */
export async function createGithubIssue(
  input: CreateIssueInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CreatedIssue> {
  const response = await fetchImpl(`https://api.github.com/repos/${input.repo}/issues`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${input.token}`,
      'content-type': 'application/json',
      'user-agent': 'arkhon-ops-bot',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({ title: input.title, body: input.body, labels: input.labels }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    number?: number;
    html_url?: string;
    message?: string;
  };
  if (!response.ok || typeof data.number !== 'number' || typeof data.html_url !== 'string') {
    throw new Error(
      `GitHub issue creation failed (${response.status}): ${data.message ?? 'unknown error'}`,
    );
  }
  return { number: data.number, url: data.html_url };
}
