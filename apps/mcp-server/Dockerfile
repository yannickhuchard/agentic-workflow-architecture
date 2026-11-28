# Image of the AWA MCP server for a hosted, public deployment.
#
# Built and checked with Docker: the image starts in public mode and answers
# initialize, tools/list and a tool call. deploy/ builds it with Cloud Build and
# runs it on Cloud Run behind Firebase Hosting.
#
# Build from the repository root, because the server uses the SDK, two views and
# the claims example that live outside this folder:
#
#   docker build -f apps/mcp-server/Dockerfile -t awa-mcp .
#   docker run -p 8080:8080 -e AWA_MCP_PUBLIC_URL=https://<your host>/mcp awa-mcp

FROM node:22-slim AS build
WORKDIR /repo
COPY sdk/typescript sdk/typescript
# The SDK's build copies the views into dist/views
COPY tools/visualization tools/visualization
RUN cd sdk/typescript && npm ci && npm run build && npm prune --omit=dev
COPY apps/mcp-server/package.json apps/mcp-server/package-lock.json apps/mcp-server/
RUN cd apps/mcp-server && npm ci --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/sdk/typescript/package.json sdk/typescript/package.json
COPY --from=build /repo/sdk/typescript/dist sdk/typescript/dist
COPY --from=build /repo/sdk/typescript/node_modules sdk/typescript/node_modules
COPY --from=build /repo/apps/mcp-server/node_modules apps/mcp-server/node_modules
COPY apps/mcp-server/package.json apps/mcp-server/package.json
COPY apps/mcp-server/src apps/mcp-server/src
COPY tools/visualization tools/visualization
COPY examples/claims-journey examples/claims-journey
COPY examples/claims-settlement/claims-settlement.awa.json examples/claims-settlement/simulation.json examples/claims-settlement/
USER node
# Public mode: the server refuses to listen here unless AWA_MCP_PUBLIC_URL is set (src/http.js)
ENV AWA_MCP_HOST=0.0.0.0 PORT=8080
EXPOSE 8080
CMD ["node", "apps/mcp-server/src/start.js"]
