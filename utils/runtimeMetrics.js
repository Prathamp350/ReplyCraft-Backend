const metrics = {
  processStartedAt: Date.now(),
  requestsStarted: 0,
  requestsCompleted: 0,
  requestsInFlight: 0,
  requestsByMethod: {},
  requestsByStatus: {},
  lastRequestAt: null,
  lastErrorAt: null,
  totalDurationMs: 0,
  slowRequestsOver1s: 0,
};

const increment = (bucket, key) => {
  bucket[key] = (bucket[key] || 0) + 1;
};

const recordRequestStart = ({ method }) => {
  metrics.requestsStarted += 1;
  metrics.requestsInFlight += 1;
  metrics.lastRequestAt = Date.now();
  increment(metrics.requestsByMethod, method || 'UNKNOWN');
};

const recordRequestComplete = ({ statusCode, durationMs }) => {
  metrics.requestsCompleted += 1;
  metrics.requestsInFlight = Math.max(0, metrics.requestsInFlight - 1);
  increment(metrics.requestsByStatus, String(statusCode || 0));
  metrics.totalDurationMs += Number(durationMs || 0);

  if ((durationMs || 0) >= 1000) {
    metrics.slowRequestsOver1s += 1;
  }

  if ((statusCode || 0) >= 500) {
    metrics.lastErrorAt = Date.now();
  }
};

const getRuntimeMetricsSnapshot = () => {
  const completed = metrics.requestsCompleted || 0;

  return {
    processStartedAt: metrics.processStartedAt,
    uptimeSeconds: Math.round(process.uptime()),
    requestsStarted: metrics.requestsStarted,
    requestsCompleted: completed,
    requestsInFlight: metrics.requestsInFlight,
    requestsByMethod: metrics.requestsByMethod,
    requestsByStatus: metrics.requestsByStatus,
    averageDurationMs: completed > 0 ? Number((metrics.totalDurationMs / completed).toFixed(2)) : 0,
    slowRequestsOver1s: metrics.slowRequestsOver1s,
    lastRequestAt: metrics.lastRequestAt,
    lastErrorAt: metrics.lastErrorAt,
    memory: process.memoryUsage(),
    pid: process.pid,
    nodeVersion: process.version,
  };
};

module.exports = {
  recordRequestStart,
  recordRequestComplete,
  getRuntimeMetricsSnapshot,
};
