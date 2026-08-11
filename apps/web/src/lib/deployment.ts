import mcpPackage from '../../../mcp/package.json';

type DeploymentEnvironment = 'production' | 'staging';

type DeploymentMetadata = {
  environment: DeploymentEnvironment;
  commit: string;
  version: string;
};

const getDeploymentMetadata = (): DeploymentMetadata | null => {
  const environment = process.env.DEPLOY_ENV;
  if (environment !== 'production' && environment !== 'staging') {
    return null;
  }

  return {
    environment,
    commit: process.env.GIT_COMMIT_SHA?.slice(0, 7) ?? 'unknown',
    version: mcpPackage.version,
  };
};

export { getDeploymentMetadata };
export type { DeploymentMetadata };
