export const tenantConfig = {
  reach: {
    name: "Reach",
    accountAccessKeyId: "BQRP633ZPD4QTLOEBAX2",
    accountAccessSecreteKey: "hBv1WoCSvrrUbc8Ql7H6VVt7fT0gzHbOwllo9AVT",
    xapiKey: "prf6kKCjty8Hicjx2hGXz5TBBW9bHRLu7G384YST",
    apiBaseUrl: process.env.REACH_API_BASE_URL || "https://api-rm-common-qa.reachmobileplatform.com",
  },
};

export function getTenantConfig(tenant) {
  return tenantConfig[tenant] || tenantConfig.reach;
}

