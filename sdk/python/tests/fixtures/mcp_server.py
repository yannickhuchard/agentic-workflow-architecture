"""
An MCP server for the tests, built with the reference SDK (the `mcp` package). Usage:
    python3 mcp_server.py stdio [marker-file]   speaks over standard input and output
    python3 mcp_server.py http <port>           serves Streamable HTTP on localhost
"""

import asyncio
import os
import sys

from mcp.server.mcpserver import MCPServer

server = MCPServer("awa-test")
calls = {"n": 0}


@server.tool(description="Counts the calls this server process has had")
def count() -> dict:
    calls["n"] += 1
    return {"count": calls["n"], "pid": os.getpid()}


@server.tool(description="Looks a policy up")
def lookup(policy: str) -> dict:
    return {"policy": policy, "covered": policy != "P-0"}


@server.tool(description="Plain text", structured_output=False)
def words() -> str:
    return "not json"


@server.tool(description="Reports an error")
def broken() -> str:
    raise RuntimeError("policy store unavailable")


@server.tool(description="Takes a second")
async def slow() -> str:
    await asyncio.sleep(1)
    return "late"


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "stdio":
        if len(sys.argv) > 2:
            with open(sys.argv[2], "w") as marker:
                marker.write(str(os.getpid()))
        server.run("stdio")
    else:
        server.run("streamable-http", host="127.0.0.1", port=int(sys.argv[2]))
