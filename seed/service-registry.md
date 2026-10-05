# How the service registry works

NooblyJS Core organises backend capabilities as **services** (logging, caching, queueing, data, filing, search, workflow, AI and more). Each service has one or more **providers**, such as `memory`, `file`, `redis` or `s3`.

## One registry, many singletons

`serviceRegistry.initialize(app, eventEmitter, options)` runs once at startup. After that, factory methods such as `serviceRegistry.cache('memory')` return a singleton keyed by service, provider and instance name.

## Dependencies are injected

Services declare dependencies on lower-level services. For example, the workflow service depends on logging, queueing, scheduling, measuring and working. When you create a service, the registry creates its dependencies with their **default providers** and passes them in as `options.dependencies`.

To use a different provider everywhere, for example Redis for queueing, call `serviceRegistry.setDefaultProvider('queueing', 'redis', options)` **before** creating anything that depends on it.

## Dashboards and APIs

Every service mounts a REST API under `/services/{service}/api/` and a dashboard under `/services/{service}/`. The dashboards require an admin login.
