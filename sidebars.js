// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  apiSidebar: [
    'index',
    'quickstart',
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: [
        'guides/handling-failed-referrals',
        'guides/verifying-webhooks',
        'guides/matching-patients',
      ],
    },
    {
      type: 'category',
      label: 'API reference',
      collapsed: false,
      items: [
        'reference/referrals',
        'reference/patients',
        'reference/appointments',
        'reference/webhooks',
        'reference/errors',
      ],
    },
    {
      type: 'category',
      label: 'Concepts',
      collapsed: true,
      items: [
        'concepts/consent-model',
        'concepts/idempotency',
        'concepts/audit-trail',
        'concepts/fhir-alignment',
      ],
    },
  ],
};

export default sidebars;
