const logger = require('../../utils/logger');

const startBullWorker = ({
  label,
  connection,
  createWorker,
}) => {
  let worker = null;

  const ensureWorker = () => {
    if (worker) {
      return worker;
    }

    worker = createWorker();
    logger.info(`[${label}] Worker started`);
    return worker;
  };

  if (connection.status === 'ready') {
    return ensureWorker();
  }

  logger.info(`[${label}] Waiting for Redis before starting worker`);
  connection.once('ready', () => {
    logger.info(`[${label}] Redis connected, starting worker`);
    ensureWorker();
  });

  return worker;
};

module.exports = {
  startBullWorker,
};
