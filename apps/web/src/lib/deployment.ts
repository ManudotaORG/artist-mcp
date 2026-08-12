import mcpPackage from '../../../mcp/package.json';

type DeploymentEnvironment = 'production' | 'staging';

type DeploymentMetadata = {
  environment: DeploymentEnvironment;
  commit: string;
  version: string;
};

type NpmDistTags = {
  staging?: unknown;
};

const getStagingVersion = async (): Promise<string> => {
  try {
    const response = await fetch(
      'https://registry.npmjs.org/-/package/@manudota%2Fartist-mcp/dist-tags',
      { cache: 'no-store' },
    );
    if (!response.ok) return 'unknown';
    const tags = (await response.json()) as NpmDistTags;
    return typeof tags.staging === 'string' ? tags.staging : 'unknown';
  } catch {
    return 'unknown';
  }
};

const getDeploymentMetadata = async (): Promise<DeploymentMetadata | null> => {
  const environment = process.env.DEPLOY_ENV;
  if (environment !== 'production' && environment !== 'staging') {
    return null;
  }

  return {
    environment,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'unknown',
    version: environment === 'staging' ? await getStagingVersion() : mcpPackage.version,
  };
};

export { getDeploymentMetadata };
export type { DeploymentMetadata };
