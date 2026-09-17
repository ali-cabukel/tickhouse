import { Client, cacheExchange, fetchExchange, subscriptionExchange } from "urql";
import { createClient as createWSClient } from "graphql-ws";

const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/graphql`;

// graphql-ws speaks the graphql-transport-ws protocol, same as Strawberry.
export const wsClient = createWSClient({
  url: wsUrl,
  lazy: false,
  retryAttempts: Infinity,
  shouldRetry: () => true,
});

export const client = new Client({
  url: "/graphql",
  exchanges: [
    cacheExchange,
    fetchExchange,
    subscriptionExchange({
      forwardSubscription(request) {
        const input = { ...request, query: request.query || "" };
        return {
          subscribe(sink) {
            const unsubscribe = wsClient.subscribe(input, sink);
            return { unsubscribe };
          },
        };
      },
    }),
  ],
});
