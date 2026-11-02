// Backward compatibility: re-export GraphQLToolHandlers as GraphQLToolHandlersRuntime
// The old monolithic GraphQLToolHandlersRuntime class has been decomposed into
// the facade pattern (handlers.impl.ts) with sub-handler modules in handlers/.
export { GraphQLToolHandlers as GraphQLToolHandlersRuntime } from '@server/domains/graphql/handlers.impl';
