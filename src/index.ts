import { Octokit } from "@octokit/rest";

interface Env {
  ENCRYPTION_KEY: string;
  ENCRYPTION_IV: string;
}

interface RequestBody {
	encryptedToken: string;
  }

async function decryptToken(encryptedToken: string, key: string, iv: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    hexToUint8Array(key),
    { name: "AES-CBC" },
    false,
    ["decrypt"]
  );

  const encryptedData = hexToUint8Array(encryptedToken);
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: hexToUint8Array(iv) },
    cryptoKey,
    encryptedData
  );

  return new TextDecoder().decode(decryptedBuffer);
}

function hexToUint8Array(hexString: string): Uint8Array {
  return new Uint8Array(hexString.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
}

async function fetchCommitsForRepo(octokit: Octokit, owner: string, repo: string, since: string) {
  try {
    const commits = await octokit.paginate(octokit.repos.listCommits, {
      owner,
      repo,
      per_page: 100,
      since,
      headers: {
        "If-None-Match": ""
      }
    });

    return commits.map((commit) => ({
      date: commit.commit.author?.date,
    }));
  } catch (error) {
    console.error(`Error fetching commits for ${repo}:`, error);
    return [];
  }
}

async function fetchAllCommits(octokit: Octokit) {
  const user = await octokit.users.getAuthenticated();
  const repos = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
    per_page: 100,
    sort: 'pushed',
    direction: 'desc'
  });

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const commitPromises = repos.map(repo =>
    fetchCommitsForRepo(octokit, user.data.login, repo.name, sevenDaysAgo)
  );

  const allCommits = await Promise.all(commitPromises);
  return allCommits.flat();
}

function processCommitsByDate(commits: any[]) {
  const commitsByDate = new Map<string, number>();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  for (let d = new Date(sevenDaysAgo); d <= new Date(); d.setDate(d.getDate() + 1)) {
    commitsByDate.set(d.toISOString().split('T')[0], 0);
  }

  commits.forEach((commit) => {
    if (commit.date) {
      const date = new Date(commit.date).toISOString().split('T')[0];
      if (commitsByDate.has(date)) {
        commitsByDate.set(date, commitsByDate.get(date)! + 1);
      }
    }
  });

  return Array.from(commitsByDate.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
		const body = await request.json() as RequestBody;
      
		if (!body || typeof body.encryptedToken !== 'string') {
		  return new Response('Invalid request body', { status: 400 });
		}
  
		const { encryptedToken } = body;      const token = await decryptToken(encryptedToken, env.ENCRYPTION_KEY, env.ENCRYPTION_IV);

      const octokit = new Octokit({ auth: token });
      const commits = await fetchAllCommits(octokit);
      const processedCommits = processCommitsByDate(commits);

      return new Response(JSON.stringify(processedCommits), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error("Error processing request:", error);
      return new Response('Error processing request', { status: 500 });
    }
  },
};