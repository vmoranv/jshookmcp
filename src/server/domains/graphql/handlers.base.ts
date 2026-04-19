// Backward compatibility: re-export GraphQLToolHandlers as GraphQLToolHandlersBase
// The old GraphQLHandlerBase class has been dissolved into shared.ts utilities + facade pattern
export { GraphQLToolHandlers as GraphQLToolHandlersBase } from '@server/domains/graphql/handlers.impl';
