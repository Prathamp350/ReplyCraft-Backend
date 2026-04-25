const requiredEnv = ['SMOKE_BASE_URL'];

const missing = requiredEnv.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const baseUrl = process.env.SMOKE_BASE_URL.replace(/\/+$/, '');

const checks = [
  {
    name: 'backend root',
    path: '/',
    expect: async (response, body) => {
      if (!response.ok) {
        throw new Error(`expected 200, received ${response.status}`);
      }

      if (!body || body.name !== 'ReplyCraft AI Backend') {
        throw new Error('missing backend identity payload');
      }
    },
  },
  {
    name: 'health',
    path: '/health',
    expect: async (response, body) => {
      if (!response.ok) {
        throw new Error(`expected 200, received ${response.status}`);
      }

      if (body.status !== 'ok') {
        throw new Error(`unexpected health status: ${body.status}`);
      }
    },
  },
  {
    name: 'liveness',
    path: '/livez',
    expect: async (response, body) => {
      if (!response.ok) {
        throw new Error(`expected 200, received ${response.status}`);
      }

      if (body.status !== 'alive') {
        throw new Error(`unexpected liveness status: ${body.status}`);
      }
    },
  },
  {
    name: 'readiness',
    path: '/readyz',
    expect: async (response, body) => {
      if (!response.ok) {
        throw new Error(`expected 200, received ${response.status}`);
      }

      if (body.success !== true) {
        throw new Error('readiness probe did not report success');
      }
    },
  },
  {
    name: 'api health',
    path: '/api/health',
    expect: async (response, body) => {
      if (!response.ok) {
        throw new Error(`expected 200, received ${response.status}`);
      }

      if (!body.success) {
        throw new Error('api health did not report success');
      }
    },
  },
];

const readBody = async (response) => {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
};

const run = async () => {
  for (const check of checks) {
    const url = `${baseUrl}${check.path}`;
    const response = await fetch(url, {
      headers: {
        accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
      },
    });
    const body = await readBody(response);
    await check.expect(response, body);
    console.log(`PASS ${check.name}: ${url}`);
  }
};

run().catch((error) => {
  console.error(`Deployed backend smoke check failed: ${error.message}`);
  process.exit(1);
});
