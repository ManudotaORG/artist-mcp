const LOCAL_SITE_URL = 'http://localhost:3000';

const getSiteUrl = (): string => {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (configuredUrl) {
    return new URL(configuredUrl).origin;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('NEXT_PUBLIC_SITE_URL is required in production.');
  }
  return LOCAL_SITE_URL;
};

export { getSiteUrl };
