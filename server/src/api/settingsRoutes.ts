import { BaseErrorSchema } from '@tunarr/types/api';
import type { ServerType } from '../types/serverType.ts';

/** Register canonical settings routes with the same handlers as their one-release aliases. */
export function registerSettingsAliases(
  fastify: ServerType,
  aliases: Record<string, string>,
) {
  const canonicalPaths = new Set(Object.values(aliases));
  fastify.addHook('onRoute', (route) => {
    if (route.method !== 'GET' && route.method !== 'PUT') {
      return;
    }
    const canonicalPath = aliases[route.routePath];
    if (canonicalPath === undefined && !canonicalPaths.has(route.routePath)) {
      return;
    }

    const response = route.schema?.response;
    route.schema = {
      ...route.schema,
      response: {
        ...(typeof response === 'object' && response !== null ? response : {}),
        400: BaseErrorSchema,
        500: BaseErrorSchema,
      },
    };
    route.errorHandler = (error, _req, reply) => {
      const status = error.statusCode ?? 500;
      void reply.status(status).send({
        message: status < 500 ? error.message : 'Could not process settings',
      });
    };

    if (canonicalPath !== undefined && canonicalPath !== route.routePath) {
      fastify.route({
        ...route,
        url: canonicalPath,
      });
      route.schema = { ...route.schema, deprecated: true };
    }
  });
}
