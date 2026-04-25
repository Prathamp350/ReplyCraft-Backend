const { AsyncLocalStorage } = require('async_hooks');

const requestContext = new AsyncLocalStorage();

const getRequestContext = () => requestContext.getStore() || null;

const runWithRequestContext = (context, callback) => requestContext.run(context, callback);

const updateRequestContext = (updates = {}) => {
  const store = requestContext.getStore();
  if (!store) return null;

  Object.assign(store, updates);
  return store;
};

module.exports = {
  getRequestContext,
  runWithRequestContext,
  updateRequestContext,
};
